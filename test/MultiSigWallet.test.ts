import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MultiSigWallet } from "../typechain-types";
import { ReentrancyAttacker } from "../typechain-types/contracts/test/ReentrancyAttacker.sol/ReentrancyAttacker";
import { SimpleReceiver } from "../typechain-types/contracts/test/SimpleReceiver";
import { parseEther, formatEther } from "ethers";

describe("MultiSigWallet", function () {
  let multiSig: MultiSigWallet;
  let owners: SignerWithAddress[];
  let nonOwner: SignerWithAddress;
  let attacker: SignerWithAddress;
  let attackerContract: ReentrancyAttacker;

  const TIME_LOCK_DELAY = 48 * 60 * 60; // 48 hours
  const TRANSACTION_EXPIRATION = 30 * 24 * 60 * 60; // 30 days
  const ADMIN_TIME_LOCK_DELAY = (TIME_LOCK_DELAY * 35) / 10; // 3.5x standard (7 days)

  beforeEach(async function () {
    // Get signers
    const signers = await ethers.getSigners();
    owners = [signers[0], signers[1], signers[2], signers[3]];
    nonOwner = signers[4];
    attacker = signers[5];

    // Deploy MultiSigWallet
    const MultiSigWalletFactory = await ethers.getContractFactory(
      "MultiSigWallet",
    );
    multiSig = await MultiSigWalletFactory.deploy(
      owners.map((o) => o.address),
      3, // 3 of 4 owners required
      TIME_LOCK_DELAY,
      TRANSACTION_EXPIRATION,
    );

    // Deploy ReentrancyAttacker contract for testing
    const AttackerFactory = await ethers.getContractFactory(
      "ReentrancyAttacker",
    );
    attackerContract = await AttackerFactory.deploy(
      await multiSig.getAddress(),
    );
  });

  describe("Deployment", function () {
    it("Should set correct default time-lock delay", async function () {
      expect(await multiSig.defaultTimeLockDelay()).to.equal(TIME_LOCK_DELAY);
    });

    it("Should set correct default transaction expiration", async function () {
      expect(await multiSig.defaultTransactionExpiration()).to.equal(
        TRANSACTION_EXPIRATION,
      );
    });

    it("Should set the correct owners", async function () {
      const contractOwners = await multiSig.getOwners();
      expect(contractOwners.length).to.equal(4);
      for (let i = 0; i < owners.length; i++) {
        expect(contractOwners[i]).to.equal(owners[i].address);
      }
    });

    it("Should set correct required confirmations", async function () {
      expect(await multiSig.requiredConfirmations()).to.equal(3);
    });

    it("Should set correct time-lock delay", async function () {
      expect(await multiSig.timeLockDelay()).to.equal(TIME_LOCK_DELAY);
    });

    it("Should set correct transaction expiration", async function () {
      expect(await multiSig.transactionExpiration()).to.equal(
        TRANSACTION_EXPIRATION,
      );
    });

    it("Should reject empty owners array", async function () {
      const MultiSigWalletFactory = await ethers.getContractFactory(
        "MultiSigWallet",
      );
      await expect(
        MultiSigWalletFactory.deploy(
          [],
          1,
          TIME_LOCK_DELAY,
          TRANSACTION_EXPIRATION,
        ),
      ).to.be.revertedWith("MultiSigWallet: Owners array cannot be empty");
    });

    it("Should reject zero address owner", async function () {
      const MultiSigWalletFactory = await ethers.getContractFactory(
        "MultiSigWallet",
      );
      await expect(
        MultiSigWalletFactory.deploy(
          [ethers.ZeroAddress],
          1,
          TIME_LOCK_DELAY,
          TRANSACTION_EXPIRATION,
        ),
      ).to.be.revertedWith("MultiSigWallet: Owner cannot be the zero address");
    });

    it("Should reject duplicate owners", async function () {
      const MultiSigWalletFactory = await ethers.getContractFactory(
        "MultiSigWallet",
      );
      await expect(
        MultiSigWalletFactory.deploy(
          [owners[0].address, owners[0].address],
          1,
          TIME_LOCK_DELAY,
          TRANSACTION_EXPIRATION,
        ),
      ).to.be.revertedWith("MultiSigWallet: Duplicate owner address");
    });

    it("Should reject invalid required confirmations (0)", async function () {
      const MultiSigWalletFactory = await ethers.getContractFactory(
        "MultiSigWallet",
      );
      await expect(
        MultiSigWalletFactory.deploy(
          [owners[0].address],
          0,
          TIME_LOCK_DELAY,
          TRANSACTION_EXPIRATION,
        ),
      ).to.be.revertedWith("MultiSigWallet: Invalid required confirmations");
    });

    it("Should reject required confirmations > owners", async function () {
      const MultiSigWalletFactory = await ethers.getContractFactory(
        "MultiSigWallet",
      );
      await expect(
        MultiSigWalletFactory.deploy(
          [owners[0].address, owners[1].address],
          3,
          TIME_LOCK_DELAY,
          TRANSACTION_EXPIRATION,
        ),
      ).to.be.revertedWith("MultiSigWallet: Invalid required confirmations");
    });

    it("Should reject time-lock delay of 0", async function () {
      await expect(
        multiSig.connect(owners[0]).submitChangeTimeLockDelay(0),
      ).to.be.revertedWith(
        "MultiSigWallet: Time-lock delay cannot be below default value",
      );
    });

    it("Should reject expiration <= time-lock", async function () {
      const MultiSigWalletFactory = await ethers.getContractFactory(
        "MultiSigWallet",
      );
      await expect(
        MultiSigWalletFactory.deploy(
          [owners[0].address],
          1,
          TIME_LOCK_DELAY,
          TIME_LOCK_DELAY,
        ),
      ).to.be.revertedWith(
        "MultiSigWallet: Expiration must be greater than time-lock delay",
      );
    });

    it("Should reject deployment with owners exceeding MAX_OWNERS", async function () {
      const MultiSigWalletFactory = await ethers.getContractFactory(
        "MultiSigWallet",
      );
      // Try to deploy with 6 owners (MAX_OWNERS is 5)
      const tooManyOwners = [
        owners[0].address,
        owners[1].address,
        owners[2].address,
        owners[3].address,
        nonOwner.address,
        attacker.address,
      ];
      await expect(
        MultiSigWalletFactory.deploy(
          tooManyOwners,
          4,
          TIME_LOCK_DELAY,
          TRANSACTION_EXPIRATION,
        ),
      ).to.be.revertedWith(
        "MultiSigWallet: Owners array exceeds maximum limit",
      );
    });
  });

  describe("Transaction Submission", function () {
    it("Should submit a transaction successfully", async function () {
      const tx = await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, parseEther("1"), "0x");
      const receipt = await tx.wait();

      expect(await multiSig.getTransactionCount()).to.equal(1);

      const transaction = await multiSig.getTransaction(1);
      expect(transaction.destination).to.equal(nonOwner.address);
      expect(transaction.value).to.equal(parseEther("1"));
      expect(transaction.executed).to.be.false;
      expect(transaction.cancelled).to.be.false;
      expect(transaction.numConfirmations).to.equal(0);
    });

    it("Should emit TransactionSubmitted event", async function () {
      await expect(
        multiSig
          .connect(owners[0])
          .submitTransaction(nonOwner.address, parseEther("1"), "0x"),
      )
        .to.emit(multiSig, "TransactionSubmitted")
        .withArgs(1, nonOwner.address, parseEther("1"), "0x");
    });

    it("Should reject submission from non-owner", async function () {
      await expect(
        multiSig.connect(nonOwner).submitTransaction(nonOwner.address, 0, "0x"),
      ).to.be.revertedWith("MultiSigWallet: Caller is not an owner");
    });

    it("Should set correct submission and expiration time", async function () {
      const beforeSubmission = await ethers.provider.getBlock("latest");
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, 0, "0x");
      const afterSubmission = await ethers.provider.getBlock("latest");

      const transaction = await multiSig.getTransaction(1);

      expect(transaction.submissionTime).to.be.gte(beforeSubmission!.timestamp);
      expect(transaction.submissionTime).to.be.lte(afterSubmission!.timestamp);

      const expectedExpiration =
        transaction.submissionTime + BigInt(TRANSACTION_EXPIRATION);
      expect(transaction.expirationTime).to.equal(expectedExpiration);
    });
  });

  describe("Transaction Confirmation", function () {
    beforeEach(async function () {
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, 0, "0x");
    });

    it("Should confirm a transaction successfully", async function () {
      await multiSig.connect(owners[0]).confirmTransaction(1);

      const transaction = await multiSig.getTransaction(1);
      expect(transaction.numConfirmations).to.equal(1);
      expect(await multiSig.isConfirmedBy(1, owners[0].address)).to.be.true;
    });

    it("Should emit TransactionConfirmed event", async function () {
      await expect(multiSig.connect(owners[0]).confirmTransaction(1))
        .to.emit(multiSig, "TransactionConfirmed")
        .withArgs(1, owners[0].address);
    });

    it("Should allow multiple confirmations from different owners", async function () {
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      const transaction = await multiSig.getTransaction(1);
      expect(transaction.numConfirmations).to.equal(3);
    });

    it("Should reject confirmation from non-owner", async function () {
      await expect(
        multiSig.connect(nonOwner).confirmTransaction(1),
      ).to.be.revertedWith("MultiSigWallet: Caller is not an owner");
    });

    it("Should reject confirmation of non-existent transaction", async function () {
      await expect(
        multiSig.connect(owners[0]).confirmTransaction(999),
      ).to.be.revertedWith("MultiSigWallet: Transaction does not exist");
    });

    it("Should reject duplicate confirmation from same owner", async function () {
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await expect(
        multiSig.connect(owners[0]).confirmTransaction(1),
      ).to.be.revertedWith(
        "MultiSigWallet: Transaction already confirmed by this owner",
      );
    });

    it("Should reject confirmation of executed transaction", async function () {
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      // Fast-forward past time-lock
      await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
      await ethers.provider.send("evm_mine", []);

      await multiSig.executeTransaction(1);

      await expect(
        multiSig.connect(owners[3]).confirmTransaction(1),
      ).to.be.revertedWith("MultiSigWallet: Transaction already executed");
    });

    it("Should reject confirmation of cancelled transaction", async function () {
      // Submit cancel transaction
      await multiSig.connect(owners[0]).submitCancelTransaction(1);
      // Confirm by 3 owners
      await multiSig.connect(owners[0]).confirmTransaction(2);
      await multiSig.connect(owners[1]).confirmTransaction(2);
      await multiSig.connect(owners[2]).confirmTransaction(2);

      // Fast-forward and execute cancellation
      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY + 1,
      ]);
      await ethers.provider.send("evm_mine", []);
      await multiSig.executeTransaction(2);

      await expect(
        multiSig.connect(owners[1]).confirmTransaction(1),
      ).to.be.revertedWith("MultiSigWallet: Transaction already cancelled");
    });

    it("Should reject confirmation of expired transaction", async function () {
      // Fast-forward past expiration
      await ethers.provider.send("evm_increaseTime", [
        TRANSACTION_EXPIRATION + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        multiSig.connect(owners[0]).confirmTransaction(1),
      ).to.be.revertedWith("MultiSigWallet: Transaction has expired");
    });
  });

  describe("Transaction Execution", function () {
    beforeEach(async function () {
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, 0, "0x");
    });

    it("Should execute transaction with enough confirmations after time-lock", async function () {
      // Confirm by 3 owners
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      // Fast-forward past time-lock
      await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
      await ethers.provider.send("evm_mine", []);

      await multiSig.executeTransaction(1);

      const transaction = await multiSig.getTransaction(1);
      expect(transaction.executed).to.be.true;
    });

    it("Should emit TransactionExecuted event", async function () {
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(multiSig.executeTransaction(1))
        .to.emit(multiSig, "TransactionExecuted")
        .withArgs(1, nonOwner.address, 0, "0x");
    });

    it("Should reject execution from non-owner", async function () {
      await expect(
        multiSig.connect(nonOwner).executeTransaction(1),
      ).to.be.revertedWith("MultiSigWallet: Caller is not an owner");
    });

    it("Should reject execution without enough confirmations", async function () {
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);

      await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
        "MultiSigWallet: Not enough confirmations",
      );
    });

    it("Should reject execution before time-lock", async function () {
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
        "MultiSigWallet: Time-lock has not passed",
      );
    });

    it("Should reject execution of non-existent transaction", async function () {
      await expect(
        multiSig.connect(owners[0]).executeTransaction(999),
      ).to.be.revertedWith("MultiSigWallet: Transaction does not exist");
    });

    it("Should reject re-execution", async function () {
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
      await ethers.provider.send("evm_mine", []);

      await multiSig.executeTransaction(1);

      await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
        "MultiSigWallet: Transaction already executed",
      );
    });

    it("Should reject execution of cancelled transaction", async function () {
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      // Submit cancel transaction for tx 1 (will be tx 2)
      await multiSig.connect(owners[0]).submitCancelTransaction(1);
      await multiSig.connect(owners[0]).confirmTransaction(2);
      await multiSig.connect(owners[1]).confirmTransaction(2);
      await multiSig.connect(owners[2]).confirmTransaction(2);

      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY + 1,
      ]);
      await ethers.provider.send("evm_mine", []);
      await multiSig.executeTransaction(2);

      await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
        "MultiSigWallet: Transaction already cancelled",
      );
    });

    it("Should reject execution of expired transaction", async function () {
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      await ethers.provider.send("evm_increaseTime", [
        TRANSACTION_EXPIRATION + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
        "MultiSigWallet: Transaction has expired",
      );
    });
  });

  describe("Transaction Cancellation", function () {
    beforeEach(async function () {
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, 0, "0x");
    });

    it("Should submit a cancel transaction successfully", async function () {
      const txId = await multiSig.connect(owners[0]).submitCancelTransaction(1);
      const receipt = await txId.wait();

      expect(await multiSig.getTransactionCount()).to.equal(2);

      // Verify transaction was created and has correct type
      const tx = await multiSig.getTransaction(2);
      const txType = await multiSig.getTransactionType(2);
      expect(await multiSig.isAdminTransaction(2)).to.be.true;
      expect(txType).to.equal(7); // CancelTransaction enum value
    });

    it("Should emit TransactionCancelSubmitted event", async function () {
      await expect(multiSig.connect(owners[0]).submitCancelTransaction(1))
        .to.emit(multiSig, "TransactionCancelSubmitted")
        .withArgs(2, 1);
    });

    it("Should cancel transaction after multi-sig approval", async function () {
      // Submit cancel transaction (tx ID 2)
      await multiSig.connect(owners[0]).submitCancelTransaction(1);

      // Confirm by 3 owners
      await multiSig.connect(owners[0]).confirmTransaction(2);
      await multiSig.connect(owners[1]).confirmTransaction(2);
      await multiSig.connect(owners[2]).confirmTransaction(2);

      // Fast-forward past admin time-lock
      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Execute cancel transaction
      await multiSig.executeTransaction(2);

      const transaction = await multiSig.getTransaction(1);
      expect(transaction.cancelled).to.be.true;
    });

    it("Should emit TransactionCancelledByMultiSig event when cancellation executes", async function () {
      await multiSig.connect(owners[0]).submitCancelTransaction(1);
      await multiSig.connect(owners[0]).confirmTransaction(2);
      await multiSig.connect(owners[1]).confirmTransaction(2);
      await multiSig.connect(owners[2]).confirmTransaction(2);

      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      await expect(multiSig.executeTransaction(2))
        .to.emit(multiSig, "TransactionCancelledByMultiSig")
        .withArgs(1); // Multi-sig decision (no specific owner)
    });

    it("Should reject cancel transaction submission from non-owner", async function () {
      await expect(
        multiSig.connect(nonOwner).submitCancelTransaction(1),
      ).to.be.revertedWith("MultiSigWallet: Caller is not an owner");
    });

    it("Should reject cancelling non-existent transaction", async function () {
      await expect(
        multiSig.connect(owners[0]).submitCancelTransaction(999),
      ).to.be.revertedWith("MultiSigWallet: Transaction does not exist");
    });

    it("Should reject cancelling already executed transaction", async function () {
      // First, confirm and execute transaction 1
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
      await ethers.provider.send("evm_mine", []);

      await multiSig.executeTransaction(1);

      // Try to submit cancel transaction for executed tx
      await expect(
        multiSig.connect(owners[0]).submitCancelTransaction(1),
      ).to.be.revertedWith(
        "MultiSigWallet: Cannot cancel an executed transaction",
      );
    });

    it("Should reject cancelling already cancelled transaction", async function () {
      // First cancel transaction 1
      await multiSig.connect(owners[0]).submitCancelTransaction(1);
      await multiSig.connect(owners[0]).confirmTransaction(2);
      await multiSig.connect(owners[1]).confirmTransaction(2);
      await multiSig.connect(owners[2]).confirmTransaction(2);

      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      await multiSig.executeTransaction(2);

      // Try to submit another cancel transaction
      await expect(
        multiSig.connect(owners[0]).submitCancelTransaction(1),
      ).to.be.revertedWith("MultiSigWallet: Transaction is already cancelled");
    });

    it("Should require multi-sig approval to cancel", async function () {
      await multiSig.connect(owners[0]).submitCancelTransaction(1);

      // Try to execute with only 1 confirmation (should fail)
      await multiSig.connect(owners[0]).confirmTransaction(2);
      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      await expect(multiSig.executeTransaction(2)).to.be.revertedWith(
        "MultiSigWallet: Not enough confirmations",
      );

      // Add 2 more confirmations
      await multiSig.connect(owners[1]).confirmTransaction(2);
      await multiSig.connect(owners[2]).confirmTransaction(2);

      // Now execute should succeed
      await multiSig.executeTransaction(2);

      const transaction = await multiSig.getTransaction(1);
      expect(transaction.cancelled).to.be.true;
    });

    it("Should reject canceling a cancellation transaction", async function () {
      // Submit a standard transaction (tx 2, since tx 1 exists from beforeEach)
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, 0, "0x");

      // Submit a cancel transaction for tx 2 (will be tx 3)
      await multiSig.connect(owners[0]).submitCancelTransaction(2);

      // Verify tx 3 is a CancelTransaction type
      const tx3Type = await multiSig.getTransactionType(3);
      expect(tx3Type).to.equal(7); // CancelTransaction enum value

      // Try to submit a cancel transaction targeting tx 3 (the cancel transaction)
      await expect(
        multiSig.connect(owners[0]).submitCancelTransaction(3),
      ).to.be.revertedWith(
        "MultiSigWallet: Cannot cancel a cancellation transaction",
      );
    });

    it("Should revert cancel tx if target was executed before cancel tx executed", async function () {
      // tx 1 exists from beforeEach (standard tx to nonOwner)

      // Submit cancel tx targeting tx 1 (becomes tx 2)
      await multiSig.connect(owners[0]).submitCancelTransaction(1);
      await multiSig.connect(owners[0]).confirmTransaction(2);
      await multiSig.connect(owners[1]).confirmTransaction(2);
      await multiSig.connect(owners[2]).confirmTransaction(2);

      // Meanwhile, also confirm tx 1 so it can be executed
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      // Fast-forward past standard time-lock (enough for tx 1, not enough for tx 2)
      await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
      await ethers.provider.send("evm_mine", []);

      // Execute tx 1 first — it succeeds
      await multiSig.executeTransaction(1);
      const tx1 = await multiSig.getTransaction(1);
      expect(tx1.executed).to.be.true;

      // Now fast-forward past admin time-lock so tx 2 (cancel) can execute
      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY - TIME_LOCK_DELAY,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Executing the cancel tx should now revert — target was already executed
      await expect(
        multiSig.connect(owners[0]).executeTransaction(2),
      ).to.be.revertedWith(
        "MultiSigWallet: Cannot cancel an executed transaction",
      );
    });
  });

  // Note: Direct owner management and parameter change functions have been removed.
  // All sensitive operations now require multi-sig approval through the transaction system.
  // See "Admin Transactions - Security Tests" section for tests of the new multi-sig workflow.

  describe("View Functions", function () {
    beforeEach(async function () {
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, parseEther("1"), "0x");
    });

    it("Should reject getTransaction for transaction ID 0", async function () {
      // Transaction ID 0 should revert because transactionExists modifier requires transactionId > 0
      await expect(multiSig.getTransaction(0)).to.be.revertedWith(
        "MultiSigWallet: Transaction does not exist",
      );
    });

    it("Should get transaction details correctly", async function () {
      const tx = await multiSig.getTransaction(1);
      expect(tx.destination).to.equal(nonOwner.address);
      expect(tx.value).to.equal(parseEther("1"));
      expect(tx.executed).to.be.false;
      expect(tx.cancelled).to.be.false;
      expect(tx.numConfirmations).to.equal(0);
    });

    it("Should return isReadyToExecute correctly", async function () {
      // Initially not ready (no confirmations, time-lock not passed)
      expect(await multiSig.isReadyToExecute(1)).to.be.false;

      // Add confirmations
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      // Still not ready (time-lock not passed)
      expect(await multiSig.isReadyToExecute(1)).to.be.false;

      // Fast-forward past time-lock
      await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
      await ethers.provider.send("evm_mine", []);

      // Now ready
      expect(await multiSig.isReadyToExecute(1)).to.be.true;
    });

    it("Should use admin time-lock for isReadyToExecute with admin transactions", async function () {
      const ADMIN_TIME_LOCK_DELAY = (TIME_LOCK_DELAY * 35) / 10;

      // Submit an admin transaction (add owner) - this will be tx ID 2
      // (tx ID 1 is the standard transaction from beforeEach)
      await multiSig.connect(owners[0]).submitAddOwner(nonOwner.address);

      // Add all required confirmations to the admin transaction (ID 2)
      await multiSig.connect(owners[0]).confirmTransaction(2);
      await multiSig.connect(owners[1]).confirmTransaction(2);
      await multiSig.connect(owners[2]).confirmTransaction(2);

      // Should not be ready initially
      expect(await multiSig.isReadyToExecute(2)).to.be.false;

      // Fast-forward past standard time-lock but NOT admin time-lock
      await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
      await ethers.provider.send("evm_mine", []);

      // Should still NOT be ready (admin time-lock not passed)
      // This test verifies the bug fix: isReadyToExecute should use adminTimeLockDelay
      expect(await multiSig.isReadyToExecute(2)).to.be.false;

      // Fast-forward past admin time-lock
      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY - TIME_LOCK_DELAY,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Now should be ready
      expect(await multiSig.isReadyToExecute(2)).to.be.true;

      // Verify execution actually works
      await multiSig.executeTransaction(2);
      expect(await multiSig.isOwner(nonOwner.address)).to.be.true;
    });

    it("Should return isConfirmedBy correctly", async function () {
      expect(await multiSig.isConfirmedBy(1, owners[0].address)).to.be.false;

      await multiSig.connect(owners[0]).confirmTransaction(1);

      expect(await multiSig.isConfirmedBy(1, owners[0].address)).to.be.true;
      expect(await multiSig.isConfirmedBy(1, owners[1].address)).to.be.false;
    });

    it("Should get transaction count correctly", async function () {
      expect(await multiSig.getTransactionCount()).to.equal(1);

      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, 0, "0x");

      expect(await multiSig.getTransactionCount()).to.equal(2);
    });
  });

  describe("Reentrancy Protection", function () {
    it("Should prevent reentrancy attack on executeTransaction", async function () {
      const attackerAddress = await attackerContract.getAddress();

      // Tell the attacker which tx to reenter (tx ID will be 1)
      // await attackerContract.setAttackTxId(1);

      // Fund the wallet so it can send ETH to the attacker
      await owners[0].sendTransaction({
        to: await multiSig.getAddress(),
        value: ethers.parseEther("1"),
      });

      // Submit a tx that sends ETH to the attacker — this triggers receive() → reentrancy
      await multiSig.connect(owners[0]).submitTransaction(
        attackerAddress,
        ethers.parseEther("0.1"), // <-- must send ETH to trigger receive()
        "0x", // no calldata needed; ETH transfer hits receive()
      );

      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
      await ethers.provider.send("evm_mine", []);

      // The reentrant call inside receive() should be blocked by ReentrancyGuard
      await expect(
        multiSig.connect(owners[0]).executeTransaction(1),
      ).to.be.revertedWithCustomError(multiSig, "ReentrancyGuardReentrantCall");
    });

    it("Should handle normal execution without reentrancy", async function () {
      // Create a simple receiver contract
      const SimpleReceiver = await ethers.getContractFactory("SimpleReceiver");
      const receiver = (await SimpleReceiver.deploy()) as SimpleReceiver;

      // Submit transaction to receiver
      const receiveCallData =
        receiver.interface.encodeFunctionData("receiveCall");
      await multiSig
        .connect(owners[0])
        .submitTransaction(await receiver.getAddress(), 0, receiveCallData);

      // Confirm by 3 owners
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      // Fast-forward past time-lock
      await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
      await ethers.provider.send("evm_mine", []);

      // Execute successfully
      await multiSig.executeTransaction(1);

      const transaction = await multiSig.getTransaction(1);
      expect(transaction.executed).to.be.true;
      expect(await receiver.callCount()).to.equal(1);
    });
  });

  describe("Admin Transactions - Security Tests", function () {
    const ADMIN_TIME_LOCK_DELAY = (TIME_LOCK_DELAY * 35) / 10; // 3.5x standard

    describe("submitAddOwner", function () {
      it("Should submit add owner transaction successfully", async function () {
        const txId = await multiSig
          .connect(owners[0])
          .submitAddOwner(nonOwner.address);
        const receipt = await txId.wait();

        expect(await multiSig.getTransactionCount()).to.equal(1);

        // Verify transaction was created and has correct type
        const tx = await multiSig.getTransaction(1);
        const txType = await multiSig.getTransactionType(1);
        expect(await multiSig.isAdminTransaction(1)).to.be.true;
      });

      it("Should reject adding zero address", async function () {
        await expect(
          multiSig.connect(owners[0]).submitAddOwner(ethers.ZeroAddress),
        ).to.be.revertedWith(
          "MultiSigWallet: Owner cannot be the zero address",
        );
      });

      it("Should reject adding existing owner", async function () {
        await expect(
          multiSig.connect(owners[0]).submitAddOwner(owners[0].address),
        ).to.be.revertedWith("MultiSigWallet: Address is already an owner");
      });

      it("Should require multi-sig approval to execute", async function () {
        await multiSig.connect(owners[0]).submitAddOwner(nonOwner.address);

        // Try to execute with only 1 confirmation (should fail)
        await multiSig.connect(owners[0]).confirmTransaction(1);
        await ethers.provider.send("evm_increaseTime", [
          ADMIN_TIME_LOCK_DELAY + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
          "MultiSigWallet: Not enough confirmations",
        );

        // Add 2 more confirmations
        await multiSig.connect(owners[1]).confirmTransaction(1);
        await multiSig.connect(owners[2]).confirmTransaction(1);

        // Now execute should succeed
        await multiSig.executeTransaction(1);

        expect(await multiSig.isOwner(nonOwner.address)).to.be.true;
      });

      it("Should enforce extended time-lock for admin transactions", async function () {
        await multiSig.connect(owners[0]).submitAddOwner(nonOwner.address);
        await multiSig.connect(owners[0]).confirmTransaction(1);
        await multiSig.connect(owners[1]).confirmTransaction(1);
        await multiSig.connect(owners[2]).confirmTransaction(1);

        // Try to execute before admin time-lock (should fail)
        await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY]);
        await ethers.provider.send("evm_mine", []);

        await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
          "MultiSigWallet: Time-lock has not passed",
        );

        // Fast-forward past admin time-lock (should succeed)
        await ethers.provider.send("evm_increaseTime", [
          ADMIN_TIME_LOCK_DELAY - TIME_LOCK_DELAY + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        await multiSig.executeTransaction(1);

        expect(await multiSig.isOwner(nonOwner.address)).to.be.true;
      });

      it("Should reject adding owner when at MAX_OWNERS limit", async function () {
        // Deploy a wallet with 5 owners (at MAX_OWNERS limit)
        const signers = await ethers.getSigners();
        const maxOwners = [
          signers[0].address,
          signers[1].address,
          signers[2].address,
          signers[3].address,
          signers[4].address,
        ];

        const MultiSigWalletFactory = await ethers.getContractFactory(
          "MultiSigWallet",
        );
        const maxMultiSig = await MultiSigWalletFactory.deploy(
          maxOwners,
          3,
          TIME_LOCK_DELAY,
          TRANSACTION_EXPIRATION,
        );

        // Try to add a 6th owner (should fail)
        await expect(
          maxMultiSig.connect(signers[0]).submitAddOwner(signers[5].address),
        ).to.be.revertedWith("MultiSigWallet: Maximum owners reached");
      });

      it("Should allow adding owner at boundary (4 to 5 owners)", async function () {
        // Current wallet has 4 owners, should be able to add 5th
        await multiSig.connect(owners[0]).submitAddOwner(nonOwner.address);
        await multiSig.connect(owners[0]).confirmTransaction(1);
        await multiSig.connect(owners[1]).confirmTransaction(1);
        await multiSig.connect(owners[2]).confirmTransaction(1);

        await ethers.provider.send("evm_increaseTime", [
          ADMIN_TIME_LOCK_DELAY + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        await multiSig.executeTransaction(1);

        expect(await multiSig.isOwner(nonOwner.address)).to.be.true;

        // Verify we now have 5 owners
        const allOwners = await multiSig.getOwners();
        expect(allOwners.length).to.equal(5);
      });
    });

    describe("submitRemoveOwner", function () {
      it("Should submit remove owner transaction successfully", async function () {
        const txId = await multiSig
          .connect(owners[0])
          .submitRemoveOwner(owners[3].address);
        await txId.wait();

        expect(await multiSig.getTransactionCount()).to.equal(1);
        expect(await multiSig.isAdminTransaction(1)).to.be.true;
      });

      it("Should reject removing non-owner address", async function () {
        await expect(
          multiSig.connect(owners[0]).submitRemoveOwner(nonOwner.address),
        ).to.be.revertedWith("MultiSigWallet: Address is not an owner");
      });

      it("Should reject removing when owners.length == requiredConfirmations", async function () {
        // Deploy a wallet with 3 owners and 3 required confirmations
        const signers = await ethers.getSigners();
        const threeOwners = [
          signers[0].address,
          signers[1].address,
          signers[2].address,
        ];

        const MultiSigWalletFactory = await ethers.getContractFactory(
          "MultiSigWallet",
        );
        const threeOwnerWallet = await MultiSigWalletFactory.deploy(
          threeOwners,
          3, // 3 of 3 owners required
          TIME_LOCK_DELAY,
          TRANSACTION_EXPIRATION,
        );

        // Try to remove an owner (should fail - would reduce owners below requiredConfirmations)
        await expect(
          threeOwnerWallet
            .connect(signers[0])
            .submitRemoveOwner(signers[2].address),
        ).to.be.revertedWith(
          "MultiSigWallet: Cannot remove owner below required confirmations",
        );
      });

      it("Should require multi-sig approval to execute", async function () {
        await multiSig.connect(owners[0]).submitRemoveOwner(owners[3].address);

        await multiSig.connect(owners[0]).confirmTransaction(1);
        await multiSig.connect(owners[1]).confirmTransaction(1);
        await multiSig.connect(owners[2]).confirmTransaction(1);

        await ethers.provider.send("evm_increaseTime", [
          ADMIN_TIME_LOCK_DELAY + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        await multiSig.executeTransaction(1);

        expect(await multiSig.isOwner(owners[3].address)).to.be.false;
      });
    });

    describe("submitReplaceOwner", function () {
      it("Should submit replace owner transaction successfully", async function () {
        const txId = await multiSig
          .connect(owners[0])
          .submitReplaceOwner(owners[3].address, nonOwner.address);
        await txId.wait();

        expect(await multiSig.getTransactionCount()).to.equal(1);
        expect(await multiSig.isAdminTransaction(1)).to.be.true;
      });

      it("Should reject when oldOwner == newOwner", async function () {
        await expect(
          multiSig
            .connect(owners[0])
            .submitReplaceOwner(owners[3].address, owners[3].address),
        ).to.be.revertedWith(
          "MultiSigWallet: Old and new owner cannot be the same",
        );
      });

      it("Should reject when newOwner is already an owner", async function () {
        await expect(
          multiSig
            .connect(owners[0])
            .submitReplaceOwner(owners[3].address, owners[0].address),
        ).to.be.revertedWith("MultiSigWallet: New address is already an owner");
      });

      it("Should reject when oldOwner is not an owner", async function () {
        await expect(
          multiSig
            .connect(owners[0])
            .submitReplaceOwner(nonOwner.address, attacker.address),
        ).to.be.revertedWith("MultiSigWallet: Old address is not an owner");
      });

      it("Should reject when newOwner is zero address", async function () {
        await expect(
          multiSig
            .connect(owners[0])
            .submitReplaceOwner(owners[3].address, ethers.ZeroAddress),
        ).to.be.revertedWith(
          "MultiSigWallet: Owner cannot be the zero address",
        );
      });

      it("Should require multi-sig approval to execute", async function () {
        await multiSig
          .connect(owners[0])
          .submitReplaceOwner(owners[3].address, nonOwner.address);

        await multiSig.connect(owners[0]).confirmTransaction(1);
        await multiSig.connect(owners[1]).confirmTransaction(1);
        await multiSig.connect(owners[2]).confirmTransaction(1);

        await ethers.provider.send("evm_increaseTime", [
          ADMIN_TIME_LOCK_DELAY + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        await multiSig.executeTransaction(1);

        expect(await multiSig.isOwner(owners[3].address)).to.be.false;
        expect(await multiSig.isOwner(nonOwner.address)).to.be.true;
      });
    });

    describe("submitChangeRequiredConfirmations", function () {
      it("Should submit change confirmations transaction successfully", async function () {
        const txId = await multiSig
          .connect(owners[0])
          .submitChangeRequiredConfirmations(2);
        await txId.wait();

        expect(await multiSig.getTransactionCount()).to.equal(1);
        expect(await multiSig.isAdminTransaction(1)).to.be.true;
      });

      it("Should reject setting newRequired = 0", async function () {
        await expect(
          multiSig.connect(owners[0]).submitChangeRequiredConfirmations(0),
        ).to.be.revertedWith(
          "MultiSigWallet: Required confirmations must be greater than 0",
        );
      });

      it("Should reject setting newRequired > owners.length", async function () {
        // Current wallet has 4 owners, try to set required to 5
        await expect(
          multiSig.connect(owners[0]).submitChangeRequiredConfirmations(5),
        ).to.be.revertedWith(
          "MultiSigWallet: Required confirmations cannot exceed number of owners",
        );
      });

      it("Should require multi-sig approval to execute", async function () {
        await multiSig.connect(owners[0]).submitChangeRequiredConfirmations(2);

        await multiSig.connect(owners[0]).confirmTransaction(1);
        await multiSig.connect(owners[1]).confirmTransaction(1);
        await multiSig.connect(owners[2]).confirmTransaction(1);

        await ethers.provider.send("evm_increaseTime", [
          ADMIN_TIME_LOCK_DELAY + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        await multiSig.executeTransaction(1);

        expect(await multiSig.requiredConfirmations()).to.equal(2);
      });
    });

    describe("submitChangeTimeLockDelay", function () {
      it("Should submit change time-lock transaction successfully", async function () {
        const newDelay = 72 * 60 * 60; // 72 hours (3 days) - above default
        const txId = await multiSig
          .connect(owners[0])
          .submitChangeTimeLockDelay(newDelay);
        await txId.wait();

        expect(await multiSig.getTransactionCount()).to.equal(1);
        expect(await multiSig.isAdminTransaction(1)).to.be.true;
      });

      it("Should reject newDelay >= transactionExpiration", async function () {
        // Try to set time-lock to equal expiration
        await expect(
          multiSig
            .connect(owners[0])
            .submitChangeTimeLockDelay(TRANSACTION_EXPIRATION),
        ).to.be.revertedWith(
          "MultiSigWallet: Time-lock delay must be less than expiration",
        );

        // Try to set time-lock greater than expiration
        const aboveExpiration = TRANSACTION_EXPIRATION + 1;
        await expect(
          multiSig
            .connect(owners[0])
            .submitChangeTimeLockDelay(aboveExpiration),
        ).to.be.revertedWith(
          "MultiSigWallet: Time-lock delay must be less than expiration",
        );
      });

      it("Should require multi-sig approval to execute", async function () {
        const newDelay = 72 * 60 * 60; // 72 hours (above default of 48 hours)
        await multiSig.connect(owners[0]).submitChangeTimeLockDelay(newDelay);

        await multiSig.connect(owners[0]).confirmTransaction(1);
        await multiSig.connect(owners[1]).confirmTransaction(1);
        await multiSig.connect(owners[2]).confirmTransaction(1);

        await ethers.provider.send("evm_increaseTime", [
          ADMIN_TIME_LOCK_DELAY + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        await multiSig.executeTransaction(1);

        expect(await multiSig.timeLockDelay()).to.equal(newDelay);
        // Admin time-lock should also be updated proportionally
        expect(await multiSig.getAdminTimeLockDelay()).to.equal(
          (newDelay * 35) / 10,
        );
      });

      it("Should reject time-lock delay that would make admin time-lock >= expiration", async function () {
        // Calculate the threshold where adminTimeLock = transactionExpiration
        // adminTimeLock = newDelay * 35/10, so newDelay = expiration * 10 / 35
        // Use Math.floor to match Solidity's integer division
        const thresholdDelay = Math.floor((TRANSACTION_EXPIRATION * 10) / 35); // 740571 seconds
        const tooHighDelay = thresholdDelay + 1; // Just above threshold (740572 seconds)

        await expect(
          multiSig.connect(owners[0]).submitChangeTimeLockDelay(tooHighDelay),
        ).to.be.revertedWith(
          "MultiSigWallet: Resulting admin time-lock would exceed expiration",
        );
      });

      it("Should accept time-lock delay just below the threshold", async function () {
        // Use Math.floor to match Solidity's integer division
        const acceptableDelay = Math.floor((TRANSACTION_EXPIRATION * 10) / 35); // 740571 seconds

        await multiSig
          .connect(owners[0])
          .submitChangeTimeLockDelay(acceptableDelay);
        // Should succeed - transaction submitted
        expect(await multiSig.getTransactionCount()).to.equal(1);
      });

      it("Should enforce floor protection - defense in depth during execution", async function () {
        // Submit a transaction with a value that's currently valid (above default)
        // but we'll try to change parameters to make it invalid during execution
        const newDelay = 72 * 60 * 60; // 72 hours (above default of 48 hours)
        await multiSig.connect(owners[0]).submitChangeTimeLockDelay(newDelay);
        await multiSig.connect(owners[0]).confirmTransaction(1);
        await multiSig.connect(owners[1]).confirmTransaction(1);
        await multiSig.connect(owners[2]).confirmTransaction(1);

        // Fast-forward past admin time-lock
        await ethers.provider.send("evm_increaseTime", [
          ADMIN_TIME_LOCK_DELAY + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        // This should succeed and execute
        await multiSig.executeTransaction(1);
        expect(await multiSig.timeLockDelay()).to.equal(newDelay);
      });

      it("Should reject time-lock delay below default floor value", async function () {
        // Default is 48 hours, try to set to 47 hours
        const belowDefault = 47 * 60 * 60;

        await expect(
          multiSig.connect(owners[0]).submitChangeTimeLockDelay(belowDefault),
        ).to.be.revertedWith(
          "MultiSigWallet: Time-lock delay cannot be below default value",
        );
      });

      it("Should reject time-lock delay equal to default floor value minus 1 second", async function () {
        // Default is 48 hours, try to set to 47:59:59
        const justBelowDefault = TIME_LOCK_DELAY - 1;

        await expect(
          multiSig
            .connect(owners[0])
            .submitChangeTimeLockDelay(justBelowDefault),
        ).to.be.revertedWith(
          "MultiSigWallet: Time-lock delay cannot be below default value",
        );
      });

      it("Should accept time-lock delay equal to default floor value", async function () {
        // Default is 48 hours, try to set to exactly 48 hours (should work - it's >=)
        const exactDefault = TIME_LOCK_DELAY;

        await multiSig
          .connect(owners[0])
          .submitChangeTimeLockDelay(exactDefault);
        // Should succeed - transaction submitted
        expect(await multiSig.getTransactionCount()).to.equal(1);
      });

      it("Should enforce floor protection during execution - defense in depth", async function () {
        // First increase time-lock to 72 hours (above default)
        const increasedTimeLock = 72 * 60 * 60;
        await multiSig
          .connect(owners[0])
          .submitChangeTimeLockDelay(increasedTimeLock);
        await multiSig.connect(owners[0]).confirmTransaction(1);
        await multiSig.connect(owners[1]).confirmTransaction(1);
        await multiSig.connect(owners[2]).confirmTransaction(1);

        await ethers.provider.send("evm_increaseTime", [
          ADMIN_TIME_LOCK_DELAY + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        await multiSig.executeTransaction(1);
        expect(await multiSig.timeLockDelay()).to.equal(increasedTimeLock);

        // Now try to decrease back to default (should work - >= default)
        const backToDefaultTimeLock = TIME_LOCK_DELAY; // 48 hours
        await multiSig
          .connect(owners[0])
          .submitChangeTimeLockDelay(backToDefaultTimeLock);
        await multiSig.connect(owners[0]).confirmTransaction(2);
        await multiSig.connect(owners[1]).confirmTransaction(2);
        await multiSig.connect(owners[2]).confirmTransaction(2);

        // After tx1 executed, adminTimeLockDelay is NOW 72h * 3.5 = 252 hours.
        // Transaction 2 was submitted after that change, so it must wait 252h.
        const newAdminTimeLock = (increasedTimeLock * 35) / 10; // 252 hours
        await ethers.provider.send("evm_increaseTime", [newAdminTimeLock + 1]);
        await ethers.provider.send("evm_mine", []);

        await multiSig.executeTransaction(2);
        expect(await multiSig.timeLockDelay()).to.equal(backToDefaultTimeLock);
      });
    });

    describe("submitChangeTransactionExpiration", function () {
      it("Should submit change expiration transaction successfully", async function () {
        const newExpiration = 60 * 24 * 60 * 60; // 60 days
        const txId = await multiSig
          .connect(owners[0])
          .submitChangeTransactionExpiration(newExpiration);
        await txId.wait();

        expect(await multiSig.getTransactionCount()).to.equal(1);
        expect(await multiSig.isAdminTransaction(1)).to.be.true;
      });

      it("Should require multi-sig approval to execute", async function () {
        const newExpiration = 60 * 24 * 60 * 60;
        await multiSig
          .connect(owners[0])
          .submitChangeTransactionExpiration(newExpiration);

        await multiSig.connect(owners[0]).confirmTransaction(1);
        await multiSig.connect(owners[1]).confirmTransaction(1);
        await multiSig.connect(owners[2]).confirmTransaction(1);

        await ethers.provider.send("evm_increaseTime", [
          ADMIN_TIME_LOCK_DELAY + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        await multiSig.executeTransaction(1);

        expect(await multiSig.transactionExpiration()).to.equal(newExpiration);
      });

      it("Should reject expiration below default floor value", async function () {
        // Default is 30 days, try to set to 29 days
        const belowDefault = 29 * 24 * 60 * 60;

        await expect(
          multiSig
            .connect(owners[0])
            .submitChangeTransactionExpiration(belowDefault),
        ).to.be.revertedWith(
          "MultiSigWallet: Expiration cannot be below default value",
        );
      });

      it("Should reject expiration equal to default floor value", async function () {
        // Default is 30 days, try to set to exactly 30 days (should work - it's >=)
        const exactDefault = 30 * 24 * 60 * 60;

        await multiSig
          .connect(owners[0])
          .submitChangeTransactionExpiration(exactDefault);
        // Should succeed - transaction submitted
        expect(await multiSig.getTransactionCount()).to.equal(1);
      });

      it("Should reject expiration below current admin time-lock", async function () {
        // Current admin time-lock is 3.5x 48 hours = 7 days
        // Try to set expiration to 6 days (below admin time-lock)
        const belowAdminTimeLock = 6 * 24 * 60 * 60;

        await expect(
          multiSig
            .connect(owners[0])
            .submitChangeTransactionExpiration(belowAdminTimeLock),
        ).to.be.revertedWith(
          "MultiSigWallet: Expiration must be greater than admin time-lock",
        );
      });

      it("Should reject expiration below current time-lock", async function () {
        // Current time-lock is 48 hours = 2 days
        // Try to set expiration to 1 day (below time-lock)
        const belowTimeLock = 1 * 24 * 60 * 60;

        await expect(
          multiSig
            .connect(owners[0])
            .submitChangeTransactionExpiration(belowTimeLock),
        ).to.be.revertedWith(
          "MultiSigWallet: Expiration must be greater than time-lock delay",
        );
      });

      it("Should enforce floor protection - defense in depth during execution", async function () {
        // First increase expiration to 60 days
        const increasedExpiration = 60 * 24 * 60 * 60;
        await multiSig
          .connect(owners[0])
          .submitChangeTransactionExpiration(increasedExpiration);
        await multiSig.connect(owners[0]).confirmTransaction(1);
        await multiSig.connect(owners[1]).confirmTransaction(1);
        await multiSig.connect(owners[2]).confirmTransaction(1);

        await ethers.provider.send("evm_increaseTime", [
          ADMIN_TIME_LOCK_DELAY + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        await multiSig.executeTransaction(1);
        expect(await multiSig.transactionExpiration()).to.equal(
          increasedExpiration,
        );

        // Now try to decrease back to default (should work - >= default)
        const backToDefault = 30 * 24 * 60 * 60;
        await multiSig
          .connect(owners[0])
          .submitChangeTransactionExpiration(backToDefault);
        await multiSig.connect(owners[0]).confirmTransaction(2);
        await multiSig.connect(owners[1]).confirmTransaction(2);
        await multiSig.connect(owners[2]).confirmTransaction(2);

        await ethers.provider.send("evm_increaseTime", [
          ADMIN_TIME_LOCK_DELAY + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        await multiSig.executeTransaction(2);
        expect(await multiSig.transactionExpiration()).to.equal(backToDefault);
      });
    });

    describe("Security: Single-Owner Vulnerability Prevention", function () {
      it("Should prevent single owner from adding themselves", async function () {
        // Submit add owner transaction
        await multiSig.connect(owners[0]).submitAddOwner(attacker.address);

        // Single owner confirms
        await multiSig.connect(owners[0]).confirmTransaction(1);

        // Fast-forward past time-lock
        await ethers.provider.send("evm_increaseTime", [
          ADMIN_TIME_LOCK_DELAY + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        // Try to execute with only 1 confirmation (should fail)
        await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
          "MultiSigWallet: Not enough confirmations",
        );

        // Attacker should NOT be an owner
        expect(await multiSig.isOwner(attacker.address)).to.be.false;
      });

      it("Should prevent single owner from removing other owners", async function () {
        // Submit remove owner transaction
        await multiSig.connect(owners[0]).submitRemoveOwner(owners[3].address);

        // Single owner confirms
        await multiSig.connect(owners[0]).confirmTransaction(1);

        // Fast-forward past time-lock
        await ethers.provider.send("evm_increaseTime", [
          ADMIN_TIME_LOCK_DELAY + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        // Try to execute with only 1 confirmation (should fail)
        await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
          "MultiSigWallet: Not enough confirmations",
        );

        // Owner should still be present
        expect(await multiSig.isOwner(owners[3].address)).to.be.true;
      });

      it("Should prevent single owner from reducing confirmations to 1", async function () {
        // Submit change confirmations transaction
        await multiSig.connect(owners[0]).submitChangeRequiredConfirmations(1);

        // Single owner confirms
        await multiSig.connect(owners[0]).confirmTransaction(1);

        // Fast-forward past time-lock
        await ethers.provider.send("evm_increaseTime", [
          ADMIN_TIME_LOCK_DELAY + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        // Try to execute with only 1 confirmation (should fail)
        await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
          "MultiSigWallet: Not enough confirmations",
        );

        // Required confirmations should still be 3
        expect(await multiSig.requiredConfirmations()).to.equal(3);
      });

      it("Should prevent single owner from executing an admin tx unilaterally", async function () {
        // Submit a valid time-lock change (above default floor of 48 hours)
        const newTimeLock = 72 * 60 * 60; // 72 hours
        await multiSig
          .connect(owners[0])
          .submitChangeTimeLockDelay(newTimeLock);

        // Single owner confirms
        await multiSig.connect(owners[0]).confirmTransaction(1);

        // Fast-forward past standard time-lock but NOT admin time-lock
        await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
        await ethers.provider.send("evm_mine", []);

        // Should fail — admin time-lock not yet passed
        await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
          "MultiSigWallet: Time-lock has not passed",
        );

        // Time-lock should be unchanged
        expect(await multiSig.timeLockDelay()).to.equal(TIME_LOCK_DELAY);
      });

      it("Should enforce time-lock for standard transactions", async function () {
        // Submit regular transaction to an EOA (no value, no data)
        await multiSig
          .connect(owners[0])
          .submitTransaction(nonOwner.address, 0, "0x");

        // Confirm with 3 owners
        await multiSig.connect(owners[0]).confirmTransaction(1);
        await multiSig.connect(owners[1]).confirmTransaction(1);
        await multiSig.connect(owners[2]).confirmTransaction(1);

        // Try to execute immediately (should fail - time-lock not passed)
        await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
          "MultiSigWallet: Time-lock has not passed",
        );

        // Fast-forward past time-lock
        await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
        await ethers.provider.send("evm_mine", []);

        // Now should succeed (EOA call with 0 value/empty data succeeds)
        await multiSig.executeTransaction(1);

        const tx = await multiSig.getTransaction(1);
        expect(tx.executed).to.be.true;
      });
    });

    describe("View Functions for Admin Transactions", function () {
      it("Should return correct transaction type", async function () {
        await multiSig.connect(owners[0]).submitAddOwner(nonOwner.address);
        await multiSig
          .connect(owners[0])
          .submitTransaction(nonOwner.address, 0, "0x");

        const tx1Type = await multiSig.getTransactionType(1);
        const tx2Type = await multiSig.getTransactionType(2);

        expect(tx1Type).to.equal(1); // AddOwner enum value
        expect(tx2Type).to.equal(0); // Standard enum value
      });

      it("Should correctly identify admin transactions", async function () {
        await multiSig.connect(owners[0]).submitAddOwner(nonOwner.address);
        await multiSig
          .connect(owners[0])
          .submitTransaction(nonOwner.address, 0, "0x");

        expect(await multiSig.isAdminTransaction(1)).to.be.true;
        expect(await multiSig.isAdminTransaction(2)).to.be.false;
      });

      it("Should return admin time-lock delay", async function () {
        const adminDelay = await multiSig.getAdminTimeLockDelay();
        expect(adminDelay).to.equal(ADMIN_TIME_LOCK_DELAY);
      });
    });

    describe("Old Functions Should Not Exist", function () {
      it("Should not have direct addOwner function", async function () {
        const walletAny = multiSig as any;
        expect(walletAny.addOwner).to.be.undefined;
      });

      it("Should not have direct removeOwner function", async function () {
        const walletAny = multiSig as any;
        expect(walletAny.removeOwner).to.be.undefined;
      });

      it("Should not have direct replaceOwner function", async function () {
        const walletAny = multiSig as any;
        expect(walletAny.replaceOwner).to.be.undefined;
      });

      it("Should not have direct changeRequiredConfirmations function", async function () {
        const walletAny = multiSig as any;
        expect(walletAny.changeRequiredConfirmations).to.be.undefined;
      });

      it("Should not have direct changeTimeLockDelay function", async function () {
        const walletAny = multiSig as any;
        expect(walletAny.changeTimeLockDelay).to.be.undefined;
      });

      it("Should not have direct changeTransactionExpiration function", async function () {
        const walletAny = multiSig as any;
        expect(walletAny.changeTransactionExpiration).to.be.undefined;
      });
    });
  });

  describe("Full Workflow Integration", function () {
    it("Should complete full submit -> confirm -> execute workflow", async function () {
      // Submit transaction
      const tx = await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, parseEther("1"), "0x");
      await tx.wait();

      expect(await multiSig.getTransactionCount()).to.equal(1);

      // Confirm by 3 owners
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      let transaction = await multiSig.getTransaction(1);
      expect(transaction.numConfirmations).to.equal(3);
      expect(transaction.executed).to.be.false;

      // Fast-forward past time-lock
      await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
      await ethers.provider.send("evm_mine", []);

      // Fund the wallet
      await owners[0].sendTransaction({
        to: await multiSig.getAddress(),
        value: parseEther("2"),
      });

      // Get recipient balance before execution
      const balanceBefore = await ethers.provider.getBalance(nonOwner.address);

      // Execute transaction
      await multiSig.executeTransaction(1);

      transaction = await multiSig.getTransaction(1);
      expect(transaction.executed).to.be.true;

      // Verify recipient received the ETH
      const balanceAfter = await ethers.provider.getBalance(nonOwner.address);
      expect(balanceAfter - balanceBefore).to.equal(parseEther("1"));
    });

    it("Should allow cancellation before execution", async function () {
      // Submit and confirm transaction
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, 0, "0x");
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      // Cancel before time-lock (submit cancel transaction - will be tx 2)
      await multiSig.connect(owners[0]).submitCancelTransaction(1);
      await multiSig.connect(owners[0]).confirmTransaction(2);
      await multiSig.connect(owners[1]).confirmTransaction(2);
      await multiSig.connect(owners[2]).confirmTransaction(2);

      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY + 1,
      ]);
      await ethers.provider.send("evm_mine", []);
      await multiSig.executeTransaction(2);

      const transaction = await multiSig.getTransaction(1);
      expect(transaction.cancelled).to.be.true;
      expect(transaction.executed).to.be.false;

      // Try to execute original transaction (should fail)
      await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
        "MultiSigWallet: Transaction already cancelled",
      );
    });

    it("Should handle multiple concurrent transactions", async function () {
      // Submit 3 transactions
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, parseEther("1"), "0x");
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, parseEther("2"), "0x");
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, parseEther("3"), "0x");

      expect(await multiSig.getTransactionCount()).to.equal(3);

      // Confirm transaction 2
      await multiSig.connect(owners[0]).confirmTransaction(2);
      await multiSig.connect(owners[1]).confirmTransaction(2);
      await multiSig.connect(owners[2]).confirmTransaction(2);

      // Cancel transaction 3 (submit cancel transaction - will be tx 4)
      await multiSig.connect(owners[0]).submitCancelTransaction(3);
      await multiSig.connect(owners[0]).confirmTransaction(4);
      await multiSig.connect(owners[1]).confirmTransaction(4);
      await multiSig.connect(owners[2]).confirmTransaction(4);

      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY + 1,
      ]);
      await ethers.provider.send("evm_mine", []);
      await multiSig.executeTransaction(4);

      // Check states
      const tx1 = await multiSig.getTransaction(1);
      const tx2 = await multiSig.getTransaction(2);
      const tx3 = await multiSig.getTransaction(3);

      expect(tx1.numConfirmations).to.equal(0);
      expect(tx2.numConfirmations).to.equal(3);
      expect(tx3.cancelled).to.be.true;
    });
  });

  describe("Time-Lock Enforcement", function () {
    beforeEach(async function () {
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, 0, "0x");
    });

    it("Should enforce time-lock for execution", async function () {
      // Confirm transaction
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      // Try to execute immediately (should fail)
      await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
        "MultiSigWallet: Time-lock has not passed",
      );

      // Fast-forward to just before time-lock (should still fail)
      await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY - 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
        "MultiSigWallet: Time-lock has not passed",
      );

      // Fast-forward past time-lock (should succeed)
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine", []);

      await multiSig.executeTransaction(1);

      const transaction = await multiSig.getTransaction(1);
      expect(transaction.executed).to.be.true;
    });

    it("Should not affect confirmation before time-lock", async function () {
      // Confirmations should work before time-lock
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      const transaction = await multiSig.getTransaction(1);
      expect(transaction.numConfirmations).to.equal(3);
    });
  });

  describe("Transaction Expiration", function () {
    beforeEach(async function () {
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, 0, "0x");
    });

    it("Should expire transaction after expiration time", async function () {
      // Confirm transaction
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      // Fast-forward past time-lock but before expiration
      await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
      await ethers.provider.send("evm_mine", []);

      // Should be able to execute
      expect(await multiSig.isReadyToExecute(1)).to.be.true;

      // Fast-forward past expiration
      await ethers.provider.send("evm_increaseTime", [
        TRANSACTION_EXPIRATION - TIME_LOCK_DELAY,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Should not be able to execute
      await expect(multiSig.executeTransaction(1)).to.be.revertedWith(
        "MultiSigWallet: Transaction has expired",
      );

      // Should not be able to confirm
      await expect(
        multiSig.connect(owners[3]).confirmTransaction(1),
      ).to.be.revertedWith("MultiSigWallet: Transaction has expired");
    });

    it("Should allow cancellation after expiration", async function () {
      // Fast-forward past expiration
      await ethers.provider.send("evm_increaseTime", [
        TRANSACTION_EXPIRATION + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Cancellation should still work (submit cancel transaction - will be tx 2)
      await multiSig.connect(owners[0]).submitCancelTransaction(1);
      await multiSig.connect(owners[0]).confirmTransaction(2);
      await multiSig.connect(owners[1]).confirmTransaction(2);
      await multiSig.connect(owners[2]).confirmTransaction(2);

      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY + 1,
      ]);
      await ethers.provider.send("evm_mine", []);
      await multiSig.executeTransaction(2);

      const transaction = await multiSig.getTransaction(1);
      expect(transaction.cancelled).to.be.true;
    });
  });

  describe("Edge Cases", function () {
    it("Should handle transaction with empty data", async function () {
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, 0, "0x");

      const transaction = await multiSig.getTransaction(1);
      expect(transaction.data).to.equal("0x");
    });

    it("Should handle transaction with zero value", async function () {
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, 0, "0x");

      const transaction = await multiSig.getTransaction(1);
      expect(transaction.value).to.equal(0);
    });

    it("Should handle maximum transaction ID", async function () {
      // This test verifies the transaction counting works correctly
      const initialCount = await multiSig.getTransactionCount();

      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, 0, "0x");
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, 0, "0x");
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, 0, "0x");

      const newCount = await multiSig.getTransactionCount();
      expect(newCount).to.equal(initialCount + BigInt(3));
    });
  });

  describe("Integration Scenarios - Parameter Change Protection", function () {
    it("Should allow safe parameter changes: increase expiration then time-lock", async function () {
      // Step 1: Increase expiration to 90 days
      const increasedExpiration = 90 * 24 * 60 * 60;
      await multiSig
        .connect(owners[0])
        .submitChangeTransactionExpiration(increasedExpiration);
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      await multiSig.executeTransaction(1);
      expect(await multiSig.transactionExpiration()).to.equal(
        increasedExpiration,
      );

      // Step 2: Now we can increase time-lock to 15 days (admin time-lock = 52.5 days < 90 days)
      const increasedTimeLock = 15 * 24 * 60 * 60;
      await multiSig
        .connect(owners[0])
        .submitChangeTimeLockDelay(increasedTimeLock);
      await multiSig.connect(owners[0]).confirmTransaction(2);
      await multiSig.connect(owners[1]).confirmTransaction(2);
      await multiSig.connect(owners[2]).confirmTransaction(2);

      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      await multiSig.executeTransaction(2);
      expect(await multiSig.timeLockDelay()).to.equal(increasedTimeLock);
      expect(await multiSig.getAdminTimeLockDelay()).to.equal(
        (increasedTimeLock * 35) / 10,
      );

      // Verify admin transactions can still execute
      await multiSig.connect(owners[0]).submitAddOwner(nonOwner.address);
      await multiSig.connect(owners[0]).confirmTransaction(3);
      await multiSig.connect(owners[1]).confirmTransaction(3);
      await multiSig.connect(owners[2]).confirmTransaction(3);

      await ethers.provider.send("evm_increaseTime", [
        (increasedTimeLock * 35) / 10 + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      await multiSig.executeTransaction(3);
      expect(await multiSig.isOwner(nonOwner.address)).to.be.true;
    });

    it("Should prevent breaking the wallet with excessive time-lock", async function () {
      // Try to set time-lock that would break the wallet
      // Use +1 to ensure it's above the threshold
      const breakingDelay = Math.floor((TRANSACTION_EXPIRATION * 10) / 35) + 1; // Above threshold

      await expect(
        multiSig.connect(owners[0]).submitChangeTimeLockDelay(breakingDelay),
      ).to.be.revertedWith(
        "MultiSigWallet: Resulting admin time-lock would exceed expiration",
      );

      // Verify wallet is still functional
      await multiSig
        .connect(owners[0])
        .submitTransaction(nonOwner.address, 0, "0x");
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      await ethers.provider.send("evm_increaseTime", [TIME_LOCK_DELAY + 1]);
      await ethers.provider.send("evm_mine", []);

      await multiSig.executeTransaction(1);
      const tx = await multiSig.getTransaction(1);
      expect(tx.executed).to.be.true;
    });

    it("Should prevent returning to default expiration when time-lock is too high", async function () {
      // Increase expiration to 90 days
      const increasedExpiration = 90 * 24 * 60 * 60;
      await multiSig
        .connect(owners[0])
        .submitChangeTransactionExpiration(increasedExpiration);
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      await multiSig.executeTransaction(1);

      // Increase time-lock to 15 days (admin time-lock = 52.5 days)
      const increasedTimeLock = 15 * 24 * 60 * 60;
      await multiSig
        .connect(owners[0])
        .submitChangeTimeLockDelay(increasedTimeLock);
      await multiSig.connect(owners[0]).confirmTransaction(2);
      await multiSig.connect(owners[1]).confirmTransaction(2);
      await multiSig.connect(owners[2]).confirmTransaction(2);

      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      await multiSig.executeTransaction(2);

      // CANNOT return expiration to default (30 days) because admin time-lock (52.5 days) exceeds it
      await expect(
        multiSig
          .connect(owners[0])
          .submitChangeTransactionExpiration(30 * 24 * 60 * 60),
      ).to.be.revertedWith(
        "MultiSigWallet: Expiration must be greater than admin time-lock",
      );

      // CAN return time-lock to default (2 days) because resulting admin time-lock (7 days) < 90 days
      const backToDefaultTimeLock = TIME_LOCK_DELAY; // 48 hours
      await multiSig
        .connect(owners[0])
        .submitChangeTimeLockDelay(backToDefaultTimeLock);
      await multiSig.connect(owners[0]).confirmTransaction(3);
      await multiSig.connect(owners[1]).confirmTransaction(3);
      await multiSig.connect(owners[2]).confirmTransaction(3);

      // Fast-forward by CURRENT admin time-lock (52.5 days from 15 days * 3.5)
      await ethers.provider.send("evm_increaseTime", [
        Math.floor((increasedTimeLock * 35) / 10) + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      await multiSig.executeTransaction(3);
      expect(await multiSig.timeLockDelay()).to.equal(backToDefaultTimeLock);
      // Admin time-lock should be back to 7 days (3.5x 48 hours)
      expect(await multiSig.getAdminTimeLockDelay()).to.equal(
        ADMIN_TIME_LOCK_DELAY,
      );
    });

    it("Should maintain invariants through multiple changes", async function () {
      const currentExpiration = await multiSig.transactionExpiration();
      const currentTimeLock = await multiSig.timeLockDelay();
      const currentAdminTimeLock = await multiSig.getAdminTimeLockDelay();

      // Verify initial invariants
      expect(currentTimeLock).to.be.lessThan(currentExpiration);
      expect(currentAdminTimeLock).to.be.lessThan(currentExpiration);

      // Increase expiration
      const newExpiration = 60 * 24 * 60 * 60;
      await multiSig
        .connect(owners[0])
        .submitChangeTransactionExpiration(newExpiration);
      await multiSig.connect(owners[0]).confirmTransaction(1);
      await multiSig.connect(owners[1]).confirmTransaction(1);
      await multiSig.connect(owners[2]).confirmTransaction(1);

      await ethers.provider.send("evm_increaseTime", [
        ADMIN_TIME_LOCK_DELAY + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      await multiSig.executeTransaction(1);

      // Verify invariants after change
      expect(await multiSig.transactionExpiration()).to.equal(newExpiration);
      expect(await multiSig.timeLockDelay()).to.be.lessThan(
        await multiSig.transactionExpiration(),
      );
      expect(await multiSig.getAdminTimeLockDelay()).to.be.lessThan(
        await multiSig.transactionExpiration(),
      );
    });
  });
});
