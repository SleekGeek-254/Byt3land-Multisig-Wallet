// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MultiSigWallet
 * @author JustDare Protocol
 * @notice An advanced multi-signature wallet contract with time-lock,
 * transaction cancellation, owner management, and expiration features.
 * @dev All sensitive operations (owner management, parameter changes) require
 * multi-sig approval through the transaction system with extended time-locks.
 */
contract MultiSigWallet is ReentrancyGuard {
    /**
     * @dev Transaction types for different operations
     */
    enum TransactionType {
        Standard, // Regular transaction
        AddOwner, // Add a new owner (requires extended time-lock)
        RemoveOwner, // Remove an owner (requires extended time-lock)
        ReplaceOwner, // Replace an owner (requires extended time-lock)
        ChangeRequiredConfirmations, // Change confirmation threshold (requires extended time-lock)
        ChangeTimeLockDelay, // Change time-lock delay (requires extended time-lock)
        ChangeTransactionExpiration, // Change expiration time (requires extended time-lock)
        CancelTransaction // Cancel a pending transaction (requires extended time-lock)
    }
    event TransactionSubmitted(
        uint256 transactionId,
        address destination,
        uint256 value,
        bytes data
    );
    event TransactionCancelSubmitted(
        uint256 transactionId,
        uint256 transactionToCancel
    );
    event TransactionConfirmed(uint256 transactionId, address owner);
    event TransactionExecuted(
        uint256 transactionId,
        address destination,
        uint256 value,
        bytes data
    );
    event TransactionCancelled(uint256 transactionId, address owner);
    event TransactionCancelledByMultiSig(uint256 transactionId);
    event OwnerAdded(address newOwner);
    event OwnerRemoved(address oldOwner);
    event OwnerReplaced(address oldOwner, address newOwner);
    event RequiredConfirmationsChanged(uint8 newRequired);
    event TimeLockDelayChanged(uint256 newDelay);
    event TransactionExpirationChanged(uint256 newExpiration);

    uint256 public constant MAX_OWNERS = 5;
    address[] public owners;
    mapping(address => bool) public isOwner;
    uint8 public requiredConfirmations;
    uint256 public transactionCount;

    // Time-lock settings (48 hours default)
    uint256 public timeLockDelay;

    // Extended time-lock for admin operations (7 days default - 2x standard)
    uint256 public adminTimeLockDelay;

    // Transaction expiration settings (30 days default)
    uint256 public transactionExpiration;

    // Default values set at deployment (cannot be reduced below these floors)
    uint256 public defaultTimeLockDelay;
    uint256 public defaultTransactionExpiration;

    /**
     * @dev Transaction structure with type support
     */
    struct Transaction {
        address destination;
        uint256 value;
        bytes data;
        TransactionType txType;
        address owner1; // For AddOwner, ReplaceOwner (new/old owner)
        address owner2; // For RemoveOwner, ReplaceOwner (old owner)
        uint8 newRequiredConfirmations; // For ChangeRequiredConfirmations
        uint256 newTimeLockDelay; // For ChangeTimeLockDelay
        uint256 newTransactionExpiration; // For ChangeTransactionExpiration
        uint256 transactionToCancel; // For CancelTransaction
        bool executed;
        bool cancelled;
        uint256 numConfirmations;
        uint256 submissionTime;
        uint256 expirationTime;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;

    modifier onlyOwner() {
        require(isOwner[msg.sender], "MultiSigWallet: Caller is not an owner");
        _;
    }

    modifier transactionExists(uint256 transactionId) {
        require(
            transactionId > 0 && transactionId <= transactionCount,
            "MultiSigWallet: Transaction does not exist"
        );
        _;
    }

    modifier notExecuted(uint256 transactionId) {
        require(
            !transactions[transactionId].executed,
            "MultiSigWallet: Transaction already executed"
        );
        _;
    }

    modifier notCancelled(uint256 transactionId) {
        require(
            !transactions[transactionId].cancelled,
            "MultiSigWallet: Transaction already cancelled"
        );
        _;
    }

    modifier notExpired(uint256 transactionId) {
        require(
            block.timestamp <= transactions[transactionId].expirationTime,
            "MultiSigWallet: Transaction has expired"
        );
        _;
    }

    modifier notConfirmed(uint256 transactionId, address owner) {
        require(
            !confirmations[transactionId][owner],
            "MultiSigWallet: Transaction already confirmed by this owner"
        );
        _;
    }

    modifier timeLockPassed(uint256 transactionId) {
        Transaction storage transaction = transactions[transactionId];
        uint256 applicableTimeLock = (transaction.txType ==
            TransactionType.Standard)
            ? timeLockDelay
            : adminTimeLockDelay;
        require(
            block.timestamp >= transaction.submissionTime + applicableTimeLock,
            "MultiSigWallet: Time-lock has not passed"
        );
        _;
    }

    constructor(
        address[] memory _owners,
        uint8 _requiredConfirmations,
        uint256 _timeLockDelay,
        uint256 _transactionExpiration
    ) {
        require(
            _owners.length > 0,
            "MultiSigWallet: Owners array cannot be empty"
        );
        require(
            _owners.length <= MAX_OWNERS,
            "MultiSigWallet: Owners array exceeds maximum limit"
        );
        require(
            _requiredConfirmations > 0 &&
                _requiredConfirmations <= _owners.length,
            "MultiSigWallet: Invalid required confirmations"
        );
        require(
            _timeLockDelay > 0,
            "MultiSigWallet: Time-lock delay must be greater than 0"
        );
        require(
            _transactionExpiration > _timeLockDelay,
            "MultiSigWallet: Expiration must be greater than time-lock delay"
        );

        owners = _owners;
        requiredConfirmations = _requiredConfirmations;
        timeLockDelay = _timeLockDelay;
        transactionExpiration = _transactionExpiration;
        // Store default values (cannot be reduced below these floors)
        defaultTimeLockDelay = _timeLockDelay;
        defaultTransactionExpiration = _transactionExpiration;
        // Admin time-lock is 3.5x standard time-lock for extra security
        adminTimeLockDelay = (_timeLockDelay * 35) / 10;

        for (uint i = 0; i < owners.length; i++) {
            address owner = owners[i];
            require(
                owner != address(0),
                "MultiSigWallet: Owner cannot be the zero address"
            );
            require(!isOwner[owner], "MultiSigWallet: Duplicate owner address");
            isOwner[owner] = true;
        }
    }

    /**
     * @notice Submit a new transaction to the wallet
     * @param destination Address to call
     * @param value ETH/POL amount to send
     * @param data Encoded function call data
     * @return transactionId ID of the submitted transaction
     */
    function submitTransaction(
        address destination,
        uint256 value,
        bytes calldata data
    ) public onlyOwner returns (uint256 transactionId) {
        transactionCount++;
        transactionId = transactionCount;

        uint256 _submissionTime = block.timestamp;
        uint256 _expirationTime = _submissionTime + transactionExpiration;

        transactions[transactionId] = Transaction({
            destination: destination,
            value: value,
            data: data,
            txType: TransactionType.Standard,
            owner1: address(0),
            owner2: address(0),
            newRequiredConfirmations: 0,
            newTimeLockDelay: 0,
            newTransactionExpiration: 0,
            transactionToCancel: 0,
            executed: false,
            cancelled: false,
            numConfirmations: 0,
            submissionTime: _submissionTime,
            expirationTime: _expirationTime
        });

        emit TransactionSubmitted(transactionId, destination, value, data);
    }

    /**
     * @notice Confirm a pending transaction
     * @param transactionId ID of the transaction to confirm
     */
    function confirmTransaction(
        uint256 transactionId
    )
        public
        onlyOwner
        transactionExists(transactionId)
        notExecuted(transactionId)
        notCancelled(transactionId)
        notExpired(transactionId)
        notConfirmed(transactionId, msg.sender)
    {
        confirmations[transactionId][msg.sender] = true;
        transactions[transactionId].numConfirmations++;
        emit TransactionConfirmed(transactionId, msg.sender);
    }

    /**
     * @notice Execute a fully confirmed transaction after time-lock
     * @param transactionId ID of the transaction to execute
     */
    function executeTransaction(
        uint256 transactionId
    )
        public
        nonReentrant
        onlyOwner
        transactionExists(transactionId)
        notExecuted(transactionId)
        notCancelled(transactionId)
        notExpired(transactionId)
        timeLockPassed(transactionId)
    {
        Transaction storage transaction = transactions[transactionId];
        require(
            transaction.numConfirmations >= requiredConfirmations,
            "MultiSigWallet: Not enough confirmations"
        );

        transaction.executed = true;
        emit TransactionExecuted(
            transactionId,
            transaction.destination,
            transaction.value,
            transaction.data
        );

        // Handle different transaction types
        if (transaction.txType == TransactionType.Standard) {
            // Standard transaction: execute external call
            (bool success, bytes memory returnData) = transaction
                .destination
                .call{value: transaction.value}(transaction.data);
            if (!success) {
                assembly {
                    revert(add(returnData, 32), mload(returnData))
                }
            }
        } else if (transaction.txType == TransactionType.AddOwner) {
            _addOwner(transaction.owner1);
        } else if (transaction.txType == TransactionType.RemoveOwner) {
            _removeOwner(transaction.owner2);
        } else if (transaction.txType == TransactionType.ReplaceOwner) {
            _replaceOwner(transaction.owner2, transaction.owner1);
        } else if (
            transaction.txType == TransactionType.ChangeRequiredConfirmations
        ) {
            _changeRequiredConfirmations(transaction.newRequiredConfirmations);
        } else if (transaction.txType == TransactionType.ChangeTimeLockDelay) {
            _changeTimeLockDelay(transaction.newTimeLockDelay);
        } else if (
            transaction.txType == TransactionType.ChangeTransactionExpiration
        ) {
            _changeTransactionExpiration(transaction.newTransactionExpiration);
        } else if (transaction.txType == TransactionType.CancelTransaction) {
            _cancelTransaction(transaction.transactionToCancel);
        }
    }

    // ============================================================================
    // ADMIN TRANSACTION SUBMISSION FUNCTIONS
    // ============================================================================

    /**
     * @notice Submit a transaction to add a new owner (requires multi-sig + extended time-lock)
     * @param newOwner Address of the new owner
     * @return transactionId ID of the submitted transaction
     */
    function submitAddOwner(
        address newOwner
    ) public onlyOwner returns (uint256 transactionId) {
        require(
            owners.length < MAX_OWNERS,
            "MultiSigWallet: Maximum owners reached"
        );
        require(
            newOwner != address(0),
            "MultiSigWallet: Owner cannot be the zero address"
        );
        require(
            !isOwner[newOwner],
            "MultiSigWallet: Address is already an owner"
        );

        transactionCount++;
        transactionId = transactionCount;

        uint256 _submissionTime = block.timestamp;
        uint256 _expirationTime = _submissionTime + transactionExpiration;

        transactions[transactionId] = Transaction({
            destination: address(0),
            value: 0,
            data: "",
            txType: TransactionType.AddOwner,
            owner1: newOwner,
            owner2: address(0),
            newRequiredConfirmations: 0,
            newTimeLockDelay: 0,
            newTransactionExpiration: 0,
            transactionToCancel: 0,
            executed: false,
            cancelled: false,
            numConfirmations: 0,
            submissionTime: _submissionTime,
            expirationTime: _expirationTime
        });

        emit TransactionSubmitted(transactionId, address(0), 0, "");
    }

    /**
     * @notice Submit a transaction to remove an owner (requires multi-sig + extended time-lock)
     * @param ownerToRemove Address of the owner to remove
     * @return transactionId ID of the submitted transaction
     */
    function submitRemoveOwner(
        address ownerToRemove
    ) public onlyOwner returns (uint256 transactionId) {
        require(
            isOwner[ownerToRemove],
            "MultiSigWallet: Address is not an owner"
        );
        require(
            owners.length > requiredConfirmations,
            "MultiSigWallet: Cannot remove owner below required confirmations"
        );

        transactionCount++;
        transactionId = transactionCount;

        uint256 _submissionTime = block.timestamp;
        uint256 _expirationTime = _submissionTime + transactionExpiration;

        transactions[transactionId] = Transaction({
            destination: address(0),
            value: 0,
            data: "",
            txType: TransactionType.RemoveOwner,
            owner1: address(0),
            owner2: ownerToRemove,
            newRequiredConfirmations: 0,
            newTimeLockDelay: 0,
            newTransactionExpiration: 0,
            transactionToCancel: 0,
            executed: false,
            cancelled: false,
            numConfirmations: 0,
            submissionTime: _submissionTime,
            expirationTime: _expirationTime
        });

        emit TransactionSubmitted(transactionId, address(0), 0, "");
    }

    /**
     * @notice Submit a transaction to replace an owner (requires multi-sig + extended time-lock)
     * @param oldOwner Address of the owner to replace
     * @param newOwner Address of the new owner
     * @return transactionId ID of the submitted transaction
     */
    function submitReplaceOwner(
        address oldOwner,
        address newOwner
    ) public onlyOwner returns (uint256 transactionId) {
        require(
            isOwner[oldOwner],
            "MultiSigWallet: Old address is not an owner"
        );
        require(
            newOwner != address(0),
            "MultiSigWallet: Owner cannot be the zero address"
        );
        require(
            oldOwner != newOwner,
            "MultiSigWallet: Old and new owner cannot be the same"
        );
        require(
            !isOwner[newOwner],
            "MultiSigWallet: New address is already an owner"
        );

        transactionCount++;
        transactionId = transactionCount;

        uint256 _submissionTime = block.timestamp;
        uint256 _expirationTime = _submissionTime + transactionExpiration;

        transactions[transactionId] = Transaction({
            destination: address(0),
            value: 0,
            data: "",
            txType: TransactionType.ReplaceOwner,
            owner1: newOwner,
            owner2: oldOwner,
            newRequiredConfirmations: 0,
            newTimeLockDelay: 0,
            newTransactionExpiration: 0,
            transactionToCancel: 0,
            executed: false,
            cancelled: false,
            numConfirmations: 0,
            submissionTime: _submissionTime,
            expirationTime: _expirationTime
        });

        emit TransactionSubmitted(transactionId, address(0), 0, "");
    }

    /**
     * @notice Submit a transaction to change required confirmations (requires multi-sig + extended time-lock)
     * @param newRequired New number of required confirmations
     * @return transactionId ID of the submitted transaction
     */
    function submitChangeRequiredConfirmations(
        uint8 newRequired
    ) public onlyOwner returns (uint256 transactionId) {
        require(
            newRequired > 0,
            "MultiSigWallet: Required confirmations must be greater than 0"
        );
        require(
            newRequired <= owners.length,
            "MultiSigWallet: Required confirmations cannot exceed number of owners"
        );

        transactionCount++;
        transactionId = transactionCount;

        uint256 _submissionTime = block.timestamp;
        uint256 _expirationTime = _submissionTime + transactionExpiration;

        transactions[transactionId] = Transaction({
            destination: address(0),
            value: 0,
            data: "",
            txType: TransactionType.ChangeRequiredConfirmations,
            owner1: address(0),
            owner2: address(0),
            newRequiredConfirmations: newRequired,
            newTimeLockDelay: 0,
            newTransactionExpiration: 0,
            transactionToCancel: 0,
            executed: false,
            cancelled: false,
            numConfirmations: 0,
            submissionTime: _submissionTime,
            expirationTime: _expirationTime
        });

        emit TransactionSubmitted(transactionId, address(0), 0, "");
    }

    /**
     * @notice Submit a transaction to change time-lock delay (requires multi-sig + extended time-lock)
     * @param newDelay New time-lock delay in seconds
     * @return transactionId ID of the submitted transaction
     */
    function submitChangeTimeLockDelay(
        uint256 newDelay
    ) public onlyOwner returns (uint256 transactionId) {
        // defaultTimeLockDelay > 0 by construction, so this implicitly checks newDelay > 0
        require(
            newDelay >= defaultTimeLockDelay,
            "MultiSigWallet: Time-lock delay cannot be below default value"
        );
        require(
            newDelay < transactionExpiration,
            "MultiSigWallet: Time-lock delay must be less than expiration"
        );
        // Calculate the resulting admin time-lock to ensure it fits within expiration
        uint256 resultingAdminTimeLock = (newDelay * 35) / 10;
        require(
            resultingAdminTimeLock < transactionExpiration,
            "MultiSigWallet: Resulting admin time-lock would exceed expiration"
        );

        transactionCount++;
        transactionId = transactionCount;

        uint256 _submissionTime = block.timestamp;
        uint256 _expirationTime = _submissionTime + transactionExpiration;

        transactions[transactionId] = Transaction({
            destination: address(0),
            value: 0,
            data: "",
            txType: TransactionType.ChangeTimeLockDelay,
            owner1: address(0),
            owner2: address(0),
            newRequiredConfirmations: 0,
            newTimeLockDelay: newDelay,
            newTransactionExpiration: 0,
            transactionToCancel: 0,
            executed: false,
            cancelled: false,
            numConfirmations: 0,
            submissionTime: _submissionTime,
            expirationTime: _expirationTime
        });

        emit TransactionSubmitted(transactionId, address(0), 0, "");
    }

    /**
     * @notice Submit a transaction to change transaction expiration (requires multi-sig + extended time-lock)
     * @param newExpiration New expiration time in seconds
     * @return transactionId ID of the submitted transaction
     */
    function submitChangeTransactionExpiration(
        uint256 newExpiration
    ) public onlyOwner returns (uint256 transactionId) {
        require(
            newExpiration > timeLockDelay,
            "MultiSigWallet: Expiration must be greater than time-lock delay"
        );
        require(
            newExpiration > adminTimeLockDelay,
            "MultiSigWallet: Expiration must be greater than admin time-lock"
        );
        require(
            newExpiration >= defaultTransactionExpiration,
            "MultiSigWallet: Expiration cannot be below default value"
        );

        transactionCount++;
        transactionId = transactionCount;

        uint256 _submissionTime = block.timestamp;
        uint256 _expirationTime = _submissionTime + transactionExpiration;

        transactions[transactionId] = Transaction({
            destination: address(0),
            value: 0,
            data: "",
            txType: TransactionType.ChangeTransactionExpiration,
            owner1: address(0),
            owner2: address(0),
            newRequiredConfirmations: 0,
            newTimeLockDelay: 0,
            newTransactionExpiration: newExpiration,
            transactionToCancel: 0,
            executed: false,
            cancelled: false,
            numConfirmations: 0,
            submissionTime: _submissionTime,
            expirationTime: _expirationTime
        });

        emit TransactionSubmitted(transactionId, address(0), 0, "");
    }

    /**
     * @notice Submit a transaction to cancel a pending transaction (requires multi-sig + extended time-lock)
     * @param _transactionToCancel ID of the transaction to cancel
     * @return transactionId ID of the submitted cancellation transaction
     */
    function submitCancelTransaction(
        uint256 _transactionToCancel
    ) public onlyOwner returns (uint256 transactionId) {
        require(
            _transactionToCancel > 0 &&
                _transactionToCancel <= transactionCount,
            "MultiSigWallet: Transaction does not exist"
        );
        require(
            !transactions[_transactionToCancel].executed,
            "MultiSigWallet: Cannot cancel an executed transaction"
        );
        require(
            !transactions[_transactionToCancel].cancelled,
            "MultiSigWallet: Transaction is already cancelled"
        );
        require(
            transactions[_transactionToCancel].txType !=
                TransactionType.CancelTransaction,
            "MultiSigWallet: Cannot cancel a cancellation transaction"
        );

        transactionCount++;
        transactionId = transactionCount;

        uint256 _submissionTime = block.timestamp;
        uint256 _expirationTime = _submissionTime + transactionExpiration;

        transactions[transactionId] = Transaction({
            destination: address(0),
            value: 0,
            data: "",
            txType: TransactionType.CancelTransaction,
            owner1: address(0),
            owner2: address(0),
            newRequiredConfirmations: 0,
            newTimeLockDelay: 0,
            newTransactionExpiration: 0,
            transactionToCancel: _transactionToCancel,
            executed: false,
            cancelled: false,
            numConfirmations: 0,
            submissionTime: _submissionTime,
            expirationTime: _expirationTime
        });

        emit TransactionCancelSubmitted(transactionId, _transactionToCancel);
    }

    // ============================================================================
    // INTERNAL FUNCTIONS FOR EXECUTING ADMIN OPERATIONS
    // ============================================================================

    /**
     * @notice Cancel a pending transaction (internal function)
     * @param transactionId ID of transaction to cancel
     */
    function _cancelTransaction(uint256 transactionId) internal {
        // Defence-in-depth: these checks mirror submitCancelTransaction's guards.
        // They protect against any future code path that might call this directly
        // without going through submitCancelTransaction's validation.
        require(
            transactionId > 0 && transactionId <= transactionCount,
            "MultiSigWallet: Transaction does not exist"
        );
        require(
            !transactions[transactionId].executed,
            "MultiSigWallet: Cannot cancel an executed transaction"
        );
        require(
            !transactions[transactionId].cancelled,
            "MultiSigWallet: Transaction is already cancelled"
        );

        transactions[transactionId].cancelled = true;
        emit TransactionCancelledByMultiSig(transactionId);
    }

    /**
     * @notice Add a new owner to wallet (internal function)
     * @param newOwner Address of the new owner
     */
    function _addOwner(address newOwner) internal {
        isOwner[newOwner] = true;
        owners.push(newOwner);
        emit OwnerAdded(newOwner);
    }

    /**
     * @notice Remove an owner from the wallet (internal function)
     * @param ownerToRemove Address of the owner to remove
     */
    function _removeOwner(address ownerToRemove) internal {
        isOwner[ownerToRemove] = false;

        // Remove from owners array
        for (uint i = 0; i < owners.length; i++) {
            if (owners[i] == ownerToRemove) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }

        emit OwnerRemoved(ownerToRemove);
    }

    /**
     * @notice Replace an existing owner with a new one (internal function)
     * @param oldOwner Address of the owner to replace
     * @param newOwner Address of the new owner
     */
    function _replaceOwner(address oldOwner, address newOwner) internal {
        isOwner[oldOwner] = false;
        isOwner[newOwner] = true;

        for (uint i = 0; i < owners.length; i++) {
            if (owners[i] == oldOwner) {
                owners[i] = newOwner;
                break;
            }
        }

        emit OwnerReplaced(oldOwner, newOwner);
    }

    /**
     * @notice Change the number of required confirmations (internal function)
     * @param newRequired New number of required confirmations
     */
    function _changeRequiredConfirmations(uint8 newRequired) internal {
        requiredConfirmations = newRequired;
        emit RequiredConfirmationsChanged(newRequired);
    }

    /**
     * @notice Change the time-lock delay (internal function)
     * @param newDelay New time-lock delay in seconds
     */
    function _changeTimeLockDelay(uint256 newDelay) internal {
        // Defense-in-depth: Calculate resulting admin time-lock and validate
        require(
            newDelay >= defaultTimeLockDelay,
            "MultiSigWallet: Time-lock delay cannot be below default value"
        );
        uint256 newAdminTimeLockDelay = (newDelay * 35) / 10;
        require(
            newAdminTimeLockDelay < transactionExpiration,
            "MultiSigWallet: Resulting admin time-lock exceeds expiration"
        );

        timeLockDelay = newDelay;
        adminTimeLockDelay = newAdminTimeLockDelay;
        emit TimeLockDelayChanged(newDelay);
    }

    /**
     * @notice Change the transaction expiration time (internal function)
     * @param newExpiration New expiration time in seconds
     */
    function _changeTransactionExpiration(uint256 newExpiration) internal {
        // Defense-in-depth: Validate expiration constraints
        require(
            newExpiration > timeLockDelay,
            "MultiSigWallet: Expiration must be greater than time-lock"
        );
        require(
            newExpiration > adminTimeLockDelay,
            "MultiSigWallet: Expiration must be greater than admin time-lock"
        );
        require(
            newExpiration >= defaultTransactionExpiration,
            "MultiSigWallet: Expiration cannot be below default value"
        );

        transactionExpiration = newExpiration;
        emit TransactionExpirationChanged(newExpiration);
    }

    function getOwners() public view returns (address[] memory) {
        return owners;
    }

    // Allow contract to receive ETH
    receive() external payable {}

    function getTransactionCount() public view returns (uint256) {
        return transactionCount;
    }

    /**
     * @notice Get detailed transaction information
     * @param transactionId ID of the transaction
     * @return destination Address to call
     * @return value ETH/POL amount to send
     * @return data Encoded function call data
     * @return executed Whether the transaction has been executed
     * @return cancelled Whether the transaction has been cancelled
     * @return numConfirmations Current number of confirmations
     * @return submissionTime Timestamp when transaction was submitted
     * @return expirationTime Timestamp when transaction expires
     */
    function getTransaction(
        uint256 transactionId
    )
        public
        view
        transactionExists(transactionId)
        returns (
            address destination,
            uint256 value,
            bytes memory data,
            bool executed,
            bool cancelled,
            uint256 numConfirmations,
            uint256 submissionTime,
            uint256 expirationTime
        )
    {
        Transaction storage transaction = transactions[transactionId];
        return (
            transaction.destination,
            transaction.value,
            transaction.data,
            transaction.executed,
            transaction.cancelled,
            transaction.numConfirmations,
            transaction.submissionTime,
            transaction.expirationTime
        );
    }

    /**
     * @notice Check if a transaction is ready to execute
     * @param transactionId ID of the transaction
     * @return ready True if transaction has enough confirmations and time-lock has passed
     */
    function isReadyToExecute(
        uint256 transactionId
    ) public view transactionExists(transactionId) returns (bool ready) {
        Transaction storage transaction = transactions[transactionId];
        bool enoughConfirmations = transaction.numConfirmations >=
            requiredConfirmations;
        uint256 applicableTimeLock = (transaction.txType ==
            TransactionType.Standard)
            ? timeLockDelay
            : adminTimeLockDelay;
        bool lockTimePassed = block.timestamp >=
            transaction.submissionTime + applicableTimeLock;
        bool txNotExecuted = !transaction.executed;
        bool txNotCancelled = !transaction.cancelled;
        bool txNotExpired = block.timestamp <= transaction.expirationTime;

        return
            enoughConfirmations &&
            lockTimePassed &&
            txNotExecuted &&
            txNotCancelled &&
            txNotExpired;
    }

    /**
     * @notice Get confirmation status for a specific owner
     * @param transactionId ID of the transaction
     * @param owner Address of the owner
     * @return confirmed True if the owner has confirmed this transaction
     */
    function isConfirmedBy(
        uint256 transactionId,
        address owner
    ) public view transactionExists(transactionId) returns (bool confirmed) {
        return confirmations[transactionId][owner];
    }

    /**
     * @notice Get transaction type
     * @param transactionId ID of the transaction
     * @return txType Type of the transaction
     */
    function getTransactionType(
        uint256 transactionId
    )
        public
        view
        transactionExists(transactionId)
        returns (TransactionType txType)
    {
        return transactions[transactionId].txType;
    }

    /**
     * @notice Get admin time-lock delay
     * @return adminTimeLockDelay Extended time-lock for admin operations
     */
    function getAdminTimeLockDelay() public view returns (uint256) {
        return adminTimeLockDelay;
    }

    /**
     * @notice Check if transaction is an admin transaction
     * @param transactionId ID of the transaction
     * @return isAdmin True if this is an admin transaction
     */
    function isAdminTransaction(
        uint256 transactionId
    ) public view transactionExists(transactionId) returns (bool isAdmin) {
        TransactionType txType = transactions[transactionId].txType;
        return txType != TransactionType.Standard;
    }
}
