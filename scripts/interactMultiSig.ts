import { ethers } from "hardhat";
import { Signer } from "ethers";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("=".repeat(80));
  console.log("MultiSigWallet Interaction Script");
  console.log("=".repeat(80));

  // Get signers
  const signers: Signer[] = await ethers.getSigners();
  const [owner1, owner2, owner3] = signers;

  // Load deployment info if available, otherwise use placeholder
  const network = await ethers.provider.getNetwork();
  const deploymentsDir = path.join(__dirname, "..", "..", "deployments");
  const outputFile = path.join(deploymentsDir, `multisig-justdare-${network.chainId}.json`);
  
  let multiSigWalletAddress: string;
  
  if (fs.existsSync(outputFile)) {
    const deploymentData = JSON.parse(fs.readFileSync(outputFile, "utf-8"));
    multiSigWalletAddress = deploymentData.multiSigWallet.address;
    console.log(`\n✅ Loaded deployment info for network: ${network.name}`);
  } else {
    multiSigWalletAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // Default for localhost
    console.log(`\n⚠️  Using placeholder address (update with deployed address)`);
  }

  const multiSigWallet = await ethers.getContractAt("MultiSigWallet", multiSigWalletAddress);

  console.log(`\nMultiSigWallet: ${multiSigWalletAddress}`);
  console.log("Using signers:");
  console.log(`  Owner 1: ${await owner1.getAddress()}`);
  console.log(`  Owner 2: ${await owner2.getAddress()}`);
  console.log(`  Owner 3: ${await owner3.getAddress()}`);

  // ========================================================================
  // Display Initial Wallet Configuration
  // ========================================================================
  console.log("\n" + "=".repeat(80));
  console.log("Wallet Configuration");
  console.log("=".repeat(80));
  
  const owners = await multiSigWallet.getOwners();
  const requiredConfirmations = await multiSigWallet.requiredConfirmations();
  const timeLockDelay = await multiSigWallet.timeLockDelay();
  const adminTimeLockDelay = await multiSigWallet.getAdminTimeLockDelay();
  const transactionExpiration = await multiSigWallet.transactionExpiration();
  
  console.log(`\nOwners (${owners.length}):`);
  owners.forEach((owner, index) => {
    console.log(`  ${index + 1}. ${owner}`);
  });
  console.log(`\nRequired Confirmations: ${requiredConfirmations.toString()}`);
  console.log(`Time-Lock Delay: ${timeLockDelay.toString()} seconds (${(Number(timeLockDelay) / 3600).toFixed(2)} hours)`);
  console.log(`Admin Time-Lock Delay: ${adminTimeLockDelay.toString()} seconds (${(Number(adminTimeLockDelay) / 86400).toFixed(2)} days)`);
  console.log(`Transaction Expiration: ${transactionExpiration.toString()} seconds (${(Number(transactionExpiration) / 86400).toFixed(2)} days)`);

  // ========================================================================
  // Scenario 1: Submit, Confirm, and Execute a Standard Transaction
  // ========================================================================
  console.log("\n" + "=".repeat(80));
  console.log("Scenario 1: Standard Transaction (Transfer ETH/POL)");
  console.log("=".repeat(80));

  const recipientAddress = await owner3.getAddress();
  const transferAmount = ethers.parseEther("0.001");

  console.log(`\nSending ${ethers.formatEther(transferAmount)} POL to ${recipientAddress}`);

  const initialTxCount = await multiSigWallet.getTransactionCount();
  const transactionId = BigInt(initialTxCount) + 1n;

  // Owner1 submits the transaction
  console.log(`\n[Owner1] Submitting transaction ${transactionId}...`);
  const submitTx = await multiSigWallet.connect(owner1).submitTransaction(recipientAddress, transferAmount, "0x");
  const submitReceipt = await submitTx.wait();
  console.log(`✅ Transaction submitted. Hash: ${submitTx.hash}`);
  console.log(`   Gas used: ${submitReceipt?.gasUsed.toString()}`);

  // Get and display transaction details
  const [dest, val, data, executed, cancelled, numConf, submitTime, expTime] = 
    await multiSigWallet.getTransaction(transactionId);
  const txType = await multiSigWallet.getTransactionType(transactionId);
  const txTypeString = ["Standard", "AddOwner", "RemoveOwner", "ReplaceOwner", 
                         "ChangeRequiredConfirmations", "ChangeTimeLockDelay", 
                         "ChangeTransactionExpiration", "CancelTransaction"][Number(txType)];

  console.log(`\n📋 Transaction Details:`);
  console.log(`   Type: ${txTypeString}`);
  console.log(`   Destination: ${dest}`);
  console.log(`   Value: ${ethers.formatEther(val)} POL`);
  console.log(`   Confirmations: ${numConf.toString()}/${requiredConfirmations.toString()}`);
  console.log(`   Submitted: ${new Date(Number(submitTime) * 1000).toLocaleString()}`);
  console.log(`   Expires: ${new Date(Number(expTime) * 1000).toLocaleString()}`);
  console.log(`   Status: ${executed ? "✅ Executed" : cancelled ? "❌ Cancelled" : "⏳ Pending"}`);

  // Owner2 confirms the transaction
  console.log(`\n[Owner2] Confirming transaction ${transactionId}...`);
  const confirmTx = await multiSigWallet.connect(owner2).confirmTransaction(transactionId);
  const confirmReceipt = await confirmTx.wait();
  console.log(`✅ Transaction confirmed. Hash: ${confirmTx.hash}`);
  console.log(`   Gas used: ${confirmReceipt?.gasUsed.toString()}`);

  // Check if ready to execute
  const isReady = await multiSigWallet.isReadyToExecute(transactionId);
  console.log(`\nReady to execute: ${isReady ? "✅ Yes" : "❌ No"}`);

  if (!isReady) {
    console.log(`⚠️  Time-lock has not passed yet. Waiting...`);
    console.log(`   Standard time-lock: ${(Number(timeLockDelay) / 60).toFixed(0)} minutes`);
    console.log(`   For testing on localhost, you can increase EVM time:`);
    console.log(`   npx hardhat console --network localhost`);
    console.log(`   > await ethers.provider.send("evm_increaseTime", [${Number(timeLockDelay)}])`);
    console.log(`   > await ethers.provider.send("evm_mine")`);
    console.log(`\nSkipping execution for this demo. In production, wait for time-lock to pass.`);
  } else {
    // Execute transaction
    console.log(`\n[Owner1] Executing transaction ${transactionId}...`);
    const executeTx = await multiSigWallet.connect(owner1).executeTransaction(transactionId);
    const executeReceipt = await executeTx.wait();
    console.log(`✅ Transaction executed. Hash: ${executeTx.hash}`);
    console.log(`   Gas used: ${executeReceipt?.gasUsed.toString()}`);
  }

  // ========================================================================
  // Scenario 2: Submit Admin Transaction (Change Required Confirmations)
  // ========================================================================
  console.log("\n" + "=".repeat(80));
  console.log("Scenario 2: Admin Transaction (Change Required Confirmations)");
  console.log("=".repeat(80));

  const currentConfirmations = await multiSigWallet.requiredConfirmations();
  const newConfirmations = Number(currentConfirmations) === 2 ? 3 : 2;
  
  console.log(`\nChanging required confirmations from ${currentConfirmations} to ${newConfirmations}`);
  console.log(`⚠️  Note: This requires extended time-lock (${(Number(adminTimeLockDelay) / 86400).toFixed(2)} days)`);

  const txCount2 = await multiSigWallet.getTransactionCount();
  const adminTxId = BigInt(txCount2) + 1n;

  // Owner1 submits admin transaction
  console.log(`\n[Owner1] Submitting admin transaction ${adminTxId}...`);
  const adminSubmitTx = await multiSigWallet.connect(owner1).submitChangeRequiredConfirmations(newConfirmations);
  const adminSubmitReceipt = await adminSubmitTx.wait();
  console.log(`✅ Admin transaction submitted. Hash: ${adminSubmitTx.hash}`);
  console.log(`   Gas used: ${adminSubmitReceipt?.gasUsed.toString()}`);

  // Display admin transaction details
  const adminTxType = await multiSigWallet.getTransactionType(adminTxId);
  const adminTxTypeString = ["Standard", "AddOwner", "RemoveOwner", "ReplaceOwner", 
                               "ChangeRequiredConfirmations", "ChangeTimeLockDelay", 
                               "ChangeTransactionExpiration", "CancelTransaction"][Number(adminTxType)];
  
  const [aDest, aVal, aData, aExecuted, aCancelled, aNumConf, aSubmitTime, aExpTime] = 
    await multiSigWallet.getTransaction(adminTxId);

  console.log(`\n📋 Admin Transaction Details:`);
  console.log(`   Type: ${adminTxTypeString}`);
  console.log(`   Confirmations: ${aNumConf.toString()}/${requiredConfirmations.toString()}`);
  console.log(`   Time-lock: ${(Number(adminTimeLockDelay) / 3600).toFixed(2)} hours (admin)`);
  console.log(`   Submitted: ${new Date(Number(aSubmitTime) * 1000).toLocaleString()}`);
  console.log(`   Expires: ${new Date(Number(aExpTime) * 1000).toLocaleString()}`);

  // ========================================================================
  // Scenario 3: Submit Transaction to Cancel a Pending Transaction
  // ========================================================================
  console.log("\n" + "=".repeat(80));
  console.log("Scenario 3: Cancel a Pending Transaction");
  console.log("=".repeat(80));

  console.log(`\nCancelling pending admin transaction ${adminTxId}`);
  console.log(`⚠️  Note: Cancellation requires multi-sig approval + admin time-lock`);

  const txCount3 = await multiSigWallet.getTransactionCount();
  const cancelTxId = BigInt(txCount3) + 1n;

  // Owner1 submits cancellation transaction
  console.log(`\n[Owner1] Submitting cancellation transaction ${cancelTxId}...`);
  const cancelSubmitTx = await multiSigWallet.connect(owner1).submitCancelTransaction(adminTxId);
  const cancelSubmitReceipt = await cancelSubmitTx.wait();
  console.log(`✅ Cancellation transaction submitted. Hash: ${cancelSubmitTx.hash}`);
  console.log(`   Gas used: ${cancelSubmitReceipt?.gasUsed.toString()}`);

  // Display cancellation transaction details
  const cancelTxType = await multiSigWallet.getTransactionType(cancelTxId);
  const cancelTxTypeString = ["Standard", "AddOwner", "RemoveOwner", "ReplaceOwner", 
                              "ChangeRequiredConfirmations", "ChangeTimeLockDelay", 
                              "ChangeTransactionExpiration", "CancelTransaction"][Number(cancelTxType)];
  
  console.log(`\n📋 Cancellation Transaction Details:`);
  console.log(`   Type: ${cancelTxTypeString}`);
  console.log(`   Target Transaction: ${adminTxId}`);
  console.log(`   Confirmations needed: ${requiredConfirmations.toString()}`);

  // ========================================================================
  // Scenario 4: Display All Pending Transactions
  // ========================================================================
  console.log("\n" + "=".repeat(80));
  console.log("Scenario 4: All Pending Transactions");
  console.log("=".repeat(80));

  const finalTxCount = await multiSigWallet.getTransactionCount();
  console.log(`\nTotal transactions: ${finalTxCount}`);
  console.log(`\nPending transactions:`);

  for (let i = 1n; i <= finalTxCount; i++) {
    const [tDest, tVal, tData, tExecuted, tCancelled, tNumConf, tSubmitTime, tExpTime] = 
      await multiSigWallet.getTransaction(i);
    
    if (!tExecuted && !tCancelled) {
      const tTxType = await multiSigWallet.getTransactionType(i);
      const tTxTypeString = ["Standard", "AddOwner", "RemoveOwner", "ReplaceOwner", 
                             "ChangeRequiredConfirmations", "ChangeTimeLockDelay", 
                             "ChangeTransactionExpiration", "CancelTransaction"][Number(tTxType)];
      
      const isAdmin = tTxTypeString !== "Standard";
      const applicableTimeLock = isAdmin ? adminTimeLockDelay : timeLockDelay;
      const timeLockPassed = block.timestamp >= Number(tSubmitTime) + Number(applicableTimeLock);
      
      console.log(`\n  Transaction ${i}:`);
      console.log(`    Type: ${tTxTypeString}`);
      console.log(`    Confirmations: ${tNumConf.toString()}/${requiredConfirmations.toString()}`);
      console.log(`    Time-lock: ${isAdmin ? "Admin" : "Standard"}`);
      console.log(`    Status: ${timeLockPassed ? "✅ Time-lock passed" : "⏳ Time-lock pending"}`);
    }
  }

  // ========================================================================
  // Summary
  // ========================================================================
  console.log("\n" + "=".repeat(80));
  console.log("Summary");
  console.log("=".repeat(80));
  
  console.log("\n✅ Demonstrated Features:");
  console.log("   1. Standard transaction submission with time-lock");
  console.log("   2. Multi-sig confirmation process");
  console.log("   3. Admin transactions with extended time-lock");
  console.log("   4. Transaction cancellation via multi-sig");
  console.log("   5. Transaction type identification");
  console.log("   6. Transaction expiration handling");
  
  console.log("\n📋 Key Functions Used:");
  console.log("   - submitTransaction()");
  console.log("   - confirmTransaction()");
  console.log("   - executeTransaction()");
  console.log("   - submitChangeRequiredConfirmations()");
  console.log("   - submitCancelTransaction()");
  console.log("   - getTransaction()");
  console.log("   - getTransactionType()");
  console.log("   - isReadyToExecute()");
  console.log("   - getAdminTimeLockDelay()");

  console.log("\n" + "=".repeat(80));
  console.log("MultiSigWallet interaction script completed successfully!");
  console.log("=".repeat(80) + "\n");
}

// Helper variable for time-lock check (in real usage, this would be actual block time)
const block = { timestamp: Math.floor(Date.now() / 1000) };

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Interaction script error:", error);
    process.exit(1);
  });