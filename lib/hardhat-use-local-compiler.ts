import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import { subtask } from "hardhat/config";

subtask(
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
  async ({ solcVersion }: { solcVersion: string }, _hre, runSuper) => {
    if (
      process.env.OVERRIDE_SOLC_COMPILER_PATH &&
      process.env.OVERRIDE_SOLC_COMPILER_VERSION
    ) {
      console.log(
        `Using override solc compiler at ${process.env.OVERRIDE_SOLC_COMPILER_PATH}`
      );

      return {
        compilerPath: process.env.OVERRIDE_SOLC_COMPILER_PATH,
        isSolcJs: false, // if you are using a native compiler, set this to false
        version: solcVersion,
        // this is used as extra information in the build-info files, but other than
        // that is not important
        longVersion: process.env.OVERRIDE_SOLC_COMPILER_VERSION,
      };
    }

    // we just use the default subtask if the version is not 0.8.5
    return runSuper();
  }
);
