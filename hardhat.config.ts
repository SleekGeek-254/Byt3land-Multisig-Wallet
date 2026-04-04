// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const { PRIVATE_KEY, POLYGON_AMOY_RPC_URL, POLYGON_MAINNET_RPC_URL } = process.env;
const AMOY_RPC = POLYGON_AMOY_RPC_URL || "https://rpc-amoy.polygon.technology";
const MAINNET_RPC = POLYGON_MAINNET_RPC_URL || "https://rpc-mainnet.polygon.network";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 10,
      },
    },
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    hardhat: {
      chainId: 31337,
      allowBlocksWithSameTimestamp: true,
    },
    amoy: {
      url: AMOY_RPC,
      chainId: 80002,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    polygon: {
      url: MAINNET_RPC,
      chainId: 137,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  sourcify: {
    enabled: false,
  },
};

export default config;

/*
Commands:

npx hardhat clean
npx hardhat node
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deployMultiSig.ts --network localhost
npx hardhat run scripts/deployMultiSig.ts --network amoy
npx hardhat run scripts/deployMultiSig.ts --network polygon
npx hardhat run scripts/interactMultiSig.ts --network localhost
npx hardhat coverage

Environment Variables (.env file):

PRIVATE_KEY=your_private_key_here
POLYGON_AMOY_RPC_URL=https://rpc-amoy.polygon.technology
POLYGON_MAINNET_RPC_URL=https://rpc-mainnet.polygon.network
*/