# Byt3land Multi-Sig Wallet

![Solidity](https://img.shields.io/badge/Solidity-^0.8.28-blue.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)
![Status](https://img.shields.io/badge/Status-Production--Ready-success.svg)

A production-ready, secure multi-signature wallet smart contract for Ethereum and EVM-compatible blockchains. Features dual time-lock system, transaction expiration, owner management, and comprehensive security protections.

## 🚀 Overview

Byt3land Multi-Sig Wallet is an advanced multi-signature wallet implementation that requires multiple approvals before executing transactions. It provides enhanced security through configurable time-locks, transaction expiration, and multi-party approval for sensitive operations like owner management and parameter changes.

### Why This Matters

Traditional single-owner smart wallets present a single point of failure. If the private key is compromised, an attacker can drain all funds instantly. Multi-sig wallets eliminate this risk by requiring multiple approvals and implementing time-delays for critical operations, providing a safety net for teams managing significant value.

## ✨ Key Features

- **🔐 Multi-Party Approval** - Configurable N-of-M confirmation threshold (e.g., 2-of-3, 3-of-5)
- **⏱️ Dual Time-Lock System** - Different delays for different operation types:
  - Standard transactions: 48 hours (configurable)
  - Admin operations: 168 hours (3.5x standard) - Owner management, parameter changes, cancellation
- **⏰ Transaction Expiration** - Transactions expire after configurable period (default: 30 days)
- **👥 Dynamic Owner Management** - Add, remove, or replace owners via multi-sig approval
- **❌ Transaction Cancellation** - Cancel pending transactions through multi-sig voting
- **🔒 Reentrancy Protection** - Built-in OpenZeppelin ReentrancyGuard
- **📊 8 Transaction Types** - Categorized operations with appropriate security levels
- **🛡️ Comprehensive Security** - Max owners limit, validation checks, floor protections
- **✅ Production-Ready** - Extensively tested with 2000+ lines of test coverage

## 🔒 Security Features

### Multi-Layer Security Model

1. **Multi-Party Approval**
   - No single owner can execute transactions unilaterally
   - Configurable confirmation threshold (1 to MAX_OWNERS)
   - Audit trail of all confirmations on-chain

2. **Time-Lock Delays**
   - Prevents hasty execution of transactions
   - Extended delays for sensitive operations (7 days)
   - Floor protection - time-locks cannot be reduced below deployment defaults

3. **Transaction Expiration**
   - Stale proposals automatically expire
   - Prevents accidental execution of old transactions
   - Configurable expiration period (must exceed time-lock)

4. **Owner Management Protections**
   - Maximum 5 owners enforced
   - Cannot reduce owners below required confirmations
   - Duplicate address prevention
   - Zero address rejection

5. **Parameter Change Protections**
   - Confirmation threshold changes require multi-sig approval
   - Time-lock changes must maintain 3.5x admin ratio
   - Expiration must exceed all time-locks
   - Cannot reduce below deployment defaults

6. **Reentrancy Guard**
   - OpenZeppelin ReentrancyGuard integration
   - Prevents reentrancy attacks during execution
   - Non-reentrant modifier on critical functions

## 📋 Transaction Types

The wallet supports 8 distinct transaction types, each with appropriate security measures:

| Type | Function | Time-Lock | Use Case |
|-------|-----------|-------------|------------|
| **Standard** | `submitTransaction()` | 48 hours | Regular transfers and function calls |
| **AddOwner** | `submitAddOwner()` | 168 hours | Add new wallet owner |
| **RemoveOwner** | `submitRemoveOwner()` | 168 hours | Remove existing owner |
| **ReplaceOwner** | `submitReplaceOwner()` | 168 hours | Replace one owner with another |
| **ChangeRequiredConfirmations** | `submitChangeRequiredConfirmations()` | 168 hours | Modify approval threshold |
| **ChangeTimeLockDelay** | `submitChangeTimeLockDelay()` | 168 hours | Update time-lock duration |
| **ChangeTransactionExpiration** | `submitChangeTransactionExpiration()` | 168 hours | Modify expiration period |
| **CancelTransaction** | `submitCancelTransaction()` | 168 hours | Cancel pending transaction |

### Transaction Flow

```
1. Submit Transaction → Transaction created with type and time-lock
2. Multi-Sig Confirmation → Other owners confirm until threshold reached
3. Time-Lock Wait → Wait for applicable time-lock to pass
4. Execute → Any owner can execute confirmed transaction
```

## 🏗️ Architecture

### Contract Design

```solidity
contract MultiSigWallet is ReentrancyGuard {
    // Core State
    address[] public owners;
    mapping(address => bool) public isOwner;
    uint8 public requiredConfirmations;
    
    // Time-Lock System
    uint256 public timeLockDelay;           // Standard: 48 hours
    uint256 public adminTimeLockDelay;        // Admin: 168 hours (3.5x)
    uint256 public transactionExpiration;        // Default: 30 days
    
    // Floor Protections
    uint256 public defaultTimeLockDelay;
    uint256 public defaultTransactionExpiration;
    
    // Transaction System
    struct Transaction {
        address destination;
        uint256 value;
        bytes data;
        TransactionType txType;
        // Type-specific fields
        address owner1, owner2;
        uint8 newRequiredConfirmations;
        uint256 newTimeLockDelay;
        uint256 newTransactionExpiration;
        uint256 transactionToCancel;
        bool executed;
        bool cancelled;
        uint256 numConfirmations;
        uint256 submissionTime;
        uint256 expirationTime;
    }
}
```

### Key Design Decisions

- **Transaction Type System**: Enum-based categorization for different security levels
- **Extended Struct**: Single struct supports all 8 transaction types
- **Floor Values**: Deployment-time minimums prevent reducing security
- **3.5x Multiplier**: Admin time-lock automatically calculated as 3.5x standard
- **MAX_OWNERS = 5**: Limits to prevent governance paralysis

## 🚀 Quick Start

### Prerequisites

- Node.js >= 16.x
- npm or yarn
- Hardhat

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/Byt3land-Multisig-Wallet.git
cd Byt3land-Multisig-Wallet

# Install dependencies
npm install

# Compile contracts
npx hardhat compile
```

### Deployment

```bash
# Deploy to local network (for testing)
npx hardhat node
npx hardhat run scripts/deployMultiSig.ts --network localhost

# Deploy to testnet (e.g., Sepolia, Amoy)
npx hardhat run scripts/deployMultiSig.ts --network amoy

# Deploy to mainnet (Polygon, Ethereum, etc.)
npx hardhat run scripts/deployMultiSig.ts --network polygon
```

### Deployment Parameters

The deployment script accepts the following configuration:

```typescript
const numOwners = 3;                    // Number of owners (max 5)
const requiredConfirmations = 2;          // N-of-M confirmations (2-of-3)
const timeLockDelay = 48 * 60 * 60;       // 48 hours in seconds
const transactionExpiration = 30 * 24 * 60 * 60; // 30 days in seconds
```

### Verification

```bash
# Verify deployment
npx hardhat run scripts/interactMultiSig.ts --network localhost
```

## 📖 Usage Examples

### Basic Transaction Flow

```typescript
import { ethers } from "hardhat";

// Get contract instance
const multiSig = await ethers.getContractAt("MultiSigWallet", contractAddress);

// Step 1: Owner A submits transaction
const tx = await multiSig.connect(ownerA).submitTransaction(
    recipientAddress,     // destination
    ethers.parseEther("1"),  // value (1 ETH/POL)
    "0x"                // encoded function call data
);
const receipt = await tx.wait();
const transactionId = await multiSig.getTransactionCount(); // e.g., 1

// Step 2: Owner B confirms
await multiSig.connect(ownerB).confirmTransaction(transactionId);

// Step 3: Owner C confirms (if 2-of-3)
await multiSig.connect(ownerC).confirmTransaction(transactionId);

// Step 4: Wait for time-lock (48 hours for standard transactions)
// On localhost, you can fast-forward:
await ethers.provider.send("evm_increaseTime", [48 * 3600]);
await ethers.provider.send("evm_mine");

// Step 5: Execute transaction
await multiSig.connect(ownerA).executeTransaction(transactionId);
```

### Owner Management

```typescript
// Add a new owner (requires 3 confirmations + 7-day time-lock)
const addTx = await multiSig.connect(ownerA).submitAddOwner(newOwnerAddress);
const txId = await multiSig.getTransactionCount();

// Confirm by all owners
await multiSig.connect(ownerA).confirmTransaction(txId);
await multiSig.connect(ownerB).confirmTransaction(txId);
await multiSig.connect(ownerC).confirmTransaction(txId);

// Wait 7 days for admin time-lock
await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600]);
await ethers.provider.send("evm_mine");

// Execute
await multiSig.connect(ownerA).executeTransaction(txId);
```

### Remove Owner

```typescript
// Remove owner (requires 3 confirmations + 7-day time-lock)
const removeTx = await multiSig.connect(ownerA).submitRemoveOwner(ownerToRemoveAddress);
const txId = await multiSig.getTransactionCount();

// Confirm and execute after time-lock
await multiSig.connect(ownerB).confirmTransaction(txId);
await multiSig.connect(ownerC).confirmTransaction(txId);
// ... wait 7 days ...
await multiSig.connect(ownerA).executeTransaction(txId);
```

### Replace Owner

```typescript
// Replace owner (requires 3 confirmations + 7-day time-lock)
const replaceTx = await multiSig.connect(ownerA).submitReplaceOwner(
    oldOwnerAddress,
    newOwnerAddress
);
const txId = await multiSig.getTransactionCount();

// Confirm and execute after time-lock
await multiSig.connect(ownerB).confirmTransaction(txId);
await multiSig.connect(ownerC).confirmTransaction(txId);
// ... wait 7 days ...
await multiSig.connect(ownerA).executeTransaction(txId);
```

### Change Parameters

```typescript
// Change required confirmations (requires 3 confirmations + 7-day time-lock)
const changeTx = await multiSig.connect(ownerA).submitChangeRequiredConfirmations(3);
const txId = await multiSig.getTransactionCount();

// Change time-lock delay (requires 3 confirmations + 7-day time-lock)
const timeLockTx = await multiSig.connect(ownerA).submitChangeTimeLockDelay(24 * 3600);

// Change transaction expiration (requires 3 confirmations + 7-day time-lock)
const expTx = await multiSig.connect(ownerA).submitChangeTransactionExpiration(60 * 24 * 3600);
```

### Cancel Transaction

```typescript
// Cancel pending transaction (requires 3 confirmations + 7-day time-lock)
const cancelTx = await multiSig.connect(ownerA).submitCancelTransaction(transactionToCancel);
const txId = await multiSig.getTransactionCount();

// Confirm and execute after time-lock
await multiSig.connect(ownerB).confirmTransaction(txId);
await multiSig.connect(ownerC).confirmTransaction(txId);
// ... wait 7 days ...
await multiSig.connect(ownerA).executeTransaction(txId);
```

### View Functions

```typescript
// Check if transaction is ready to execute
const isReady = await multiSig.isReadyToExecute(transactionId);

// Get transaction details
const [dest, val, data, executed, cancelled, numConfirmations, submitTime, expTime] = 
    await multiSig.getTransaction(transactionId);

// Check if confirmed by specific owner
const confirmedByOwnerA = await multiSig.isConfirmedBy(transactionId, ownerA.address);

// Get transaction type
const txType = await multiSig.getTransactionType(transactionId);
// Returns enum: Standard=0, AddOwner=1, RemoveOwner=2, etc.

// Get admin time-lock delay
const adminDelay = await multiSig.getAdminTimeLockDelay();

// Check if admin transaction
const isAdmin = await multiSig.isAdminTransaction(transactionId);
```

## 🧪 Testing

### Run All Tests

```bash
# Run complete test suite
npx hardhat test

# Run with coverage
npx hardhat coverage

# Run specific test file
npx hardhat test test/MultiSigWallet.test.ts

# Run with gas reporting
REPORT_GAS=true npx hardhat test
```

### Test Coverage

The test suite includes comprehensive coverage for:

- ✅ Deployment validation
- ✅ Transaction submission and confirmation
- ✅ Execution with time-lock enforcement
- ✅ Transaction cancellation
- ✅ Owner management (add/remove/replace)
- ✅ Parameter changes (confirmations, time-lock, expiration)
- ✅ Reentrancy protection
- ✅ View functions
- ✅ Edge cases and error conditions

### Test Scenarios

The tests demonstrate all 8 transaction types with proper multi-sig workflow:
- Standard transactions with 48-hour time-lock
- Admin transactions with 168-hour time-lock
- Multi-sig confirmation process
- Transaction cancellation via multi-sig
- Owner management operations
- Parameter change operations
- Reentrancy attack prevention

## 🔐 Security Best Practices

### For Deployment

1. **Use Hardware Wallets**
   - Deploy with Ledger, Trezor, or similar
   - Never use exchange wallets or hot wallets for production

2. **Choose Appropriate Parameters**
   - More owners = more security but slower operations
   - Recommended: 3-5 owners with N-1 or N-2 confirmations
   - Consider your team's response time when setting time-locks

3. **Test Thoroughly**
   - Test on local network first
   - Deploy to testnet before mainnet
   - Verify all functionality with real transactions

4. **Audit Contract**
   - Consider professional security audit for production deployments
   - Review code for vulnerabilities
   - Test with common attack vectors

### For Operations

1. **Verify Before Confirming**
   - Always review transaction details before confirming
   - Use out-of-band communication to verify proposals
   - Be suspicious of urgent requests

2. **Monitor Transactions**
   - Check for unexpected proposals regularly
   - Use view functions to track pending transactions
   - Set up alerts for new submissions

3. **Key Management**
   - Use separate wallets for different roles
   - Keep private keys offline when possible
   - Rotate keys periodically (annually recommended)

4. **Emergency Procedures**
   - Plan for lost keys or compromised owners
   - Document recovery procedures
   - Have backup owners ready

### For Integration

1. **Use Time-Locks Effectively**
   - Submit sensitive operations early
   - Use time-lock period for thorough review
   - Don't bypass time-locks in testing

2. **Transaction Expiration**
   - Monitor for expiring transactions
   - Re-submit if important proposals expire
   - Set appropriate expiration for your use case

3. **Gas Optimization**
   - Batch related operations when possible
   - Monitor gas costs and optimize
   - Use lower gas periods for non-critical ops

## 📊 Technical Specifications

### Solidity Version
- `^0.8.28`

### Dependencies
- OpenZeppelin Contracts `>=4.9.0`
  - ReentrancyGuard

### Gas Costs (Estimated)

| Operation | Gas Used | Est. Cost (at 30 gwei) |
|------------|-------------|---------------------------|
| Deployment | ~2,500,000 | ~0.075 ETH/POL |
| Submit Transaction | ~85,000 | ~0.00255 ETH/POL |
| Confirm Transaction | ~45,000 | ~0.00135 ETH/POL |
| Execute Transaction | ~120,000 | ~0.0036 ETH/POL |
| Add Owner | ~150,000 | ~0.0045 ETH/POL |

### Limits

- **MAX_OWNERS**: 5
- **Minimum Confirmations**: 1
- **Maximum Confirmations**: Number of owners
- **Time-Lock Minimum**: Deployment value (floor protection)
- **Expiration Minimum**: Deployment value (floor protection)

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow Solidity best practices
- Add tests for new features
- Update documentation
- Maintain test coverage > 90%
- Use descriptive commit messages

### Testing Guidelines

- Write tests for all new functions
- Include edge cases and error conditions
- Test with different parameter combinations
- Verify gas costs are reasonable

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Resources

- [Solidity Documentation](https://docs.soliditylang.org/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- [Hardhat Documentation](https://hardhat.org/getting-started/)
- [Ethereum Multi-Sig Best Practices](https://consensys.github.io/smart-contract-best-practices/security-recommendations/)

## 📞 Support

For issues, questions, or contributions:
- Open an issue on GitHub
- Review existing issues before creating new ones
- Provide detailed information and reproduction steps

## ⚠️ Disclaimer

This software is provided "as is", without warranty of any kind. Use at your own risk. Always test thoroughly and consider professional security audits for production deployments involving significant value.

---

**Built with ❤️ by Byt3land**
