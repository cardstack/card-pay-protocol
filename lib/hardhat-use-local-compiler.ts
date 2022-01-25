import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";

import { subtask } from "hardhat/config";

subtask(
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
  async ({ solcVersion }: { solcVersion: string }, hre, runSuper) => {
    if (solcVersion === "0.8.9") {
      const compilerPath = "/opt/homebrew/bin/solc";

      return {
        compilerPath,
        isSolcJs: false, // if you are using a native compiler, set this to false
        version: solcVersion,
        // this is used as extra information in the build-info files, but other than
        // that is not important
        longVersion: "0.8.9+commit.e5eed63a.Darwin.appleclang",
      };
    }

    // we just use the default subtask if the version is not 0.8.5
    return runSuper();
  }
);
