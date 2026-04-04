import { ethers } from "hardhat";
import { Signer } from "ethers";

async function main() {
  console.log("Starting MultiSigWallet deployment...");

  // Get the contract factory
  const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
  console.log("MultiSigWallet contract factory initialized");

  // Define owners and required confirmations
  // For testing, you can use the first few signers from your Hardhat network.
  // For mainnet deployment, you would replace these with specific owner addresses.
  const signers: Signer[] = await ethers.getSigners();
  const numOwners = 3; // e.g., 3 owners
  const requiredConfirmationsNum = 2; // e.g., 2-of-3 multisig

  // Time-lock and expiration settings
  const timeLockDelay = 48 * 60 * 60; // 48 hours in seconds
  const transactionExpiration = 30 * 24 * 60 * 60; // 30 days in seconds

  if (signers.length < numOwners) {
    console.error(`Error: Not enough signers configured in Hardhat network. Expected at least ${numOwners}, got ${signers.length}`);
    process.exit(1);
  }

  const owners = await Promise.all(
    signers.slice(0, numOwners).map(signer => signer.getAddress())
  );

  console.log("Owners:", owners);
  console.log("Required Confirmations:", requiredConfirmationsNum);
  console.log("Time-lock delay:", timeLockDelay / 3600, "hours");
  console.log("Transaction expiration:", transactionExpiration / (24 * 3600), "days");

  // Get current gas price (optional, for potential cost display if estimation was available)
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.parseUnits("30", "gwei"); // Fallback gas price
  console.log("Current gas price (wei):", gasPrice?.toString() || "N/A");
  console.log("Current gas price (gwei):", gasPrice ? ethers.formatUnits(gasPrice, "gwei") : "N/A");
  console.log("Note: Detailed gas estimation for deployment is skipped in this version.");

  // Deploy the contract
  console.log("\nDeploying MultiSigWallet contract...");
  const multiSigWallet = await MultiSigWallet.deploy(
    owners,
    requiredConfirmationsNum,
    timeLockDelay,
    transactionExpiration
  );

  // Wait for deployment to finish
  console.log("Waiting for deployment to complete...");
  await multiSigWallet.waitForDeployment();

  // Get actual deployment transaction details
  const deploymentTx = multiSigWallet.deploymentTransaction();
  if (!deploymentTx) {
    console.error("Error: Could not retrieve deployment transaction.");
    process.exit(1);
  }

  const deploymentReceipt = await ethers.provider.getTransactionReceipt(deploymentTx.hash);
  if (!deploymentReceipt) {
    console.error("Error: Could not retrieve deployment receipt.");
    // We can still proceed to get the address even without the full receipt
  }

  if (deploymentReceipt) {
    console.log("Actual gas used:", deploymentReceipt.gasUsed.toString());
    // Calculate actual cost only if gasPrice is available
    if (gasPrice) {
        const actualCost = deploymentReceipt.gasUsed * BigInt(gasPrice.toString());
        console.log("Actual cost (wei):", actualCost.toString());
        console.log("Actual cost (POL):", ethers.formatEther(actualCost));
    } else {
        console.log("Actual cost (POL): N/A (gas price not available)");
    }
  } else {
    console.log("Could not retrieve deployment receipt for gas details.");
  }


  // Get the contract address
  const contractAddress = await multiSigWallet.getAddress();
  console.log("\nMultiSigWallet deployed to:", contractAddress);
  console.log("Transaction hash:", deploymentTx.hash);

  // Verify contract is working by calling a view function
  const retrievedOwners = await multiSigWallet.getOwners();
  console.log("Retrieved owners from contract:", retrievedOwners);
  const retrievedRequiredConfirmations = await multiSigWallet.requiredConfirmations();
  console.log("Retrieved required confirmations from contract:", retrievedRequiredConfirmations.toString());

  if (JSON.stringify(retrievedOwners) === JSON.stringify(owners) && retrievedRequiredConfirmations.toString() === requiredConfirmationsNum.toString()) {
    console.log("Contract initialization verified successfully.");
  } else {
    console.error("Error: Contract initialization verification failed.");
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment error:", error);
    process.exit(1);
  });