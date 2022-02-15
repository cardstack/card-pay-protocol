import { subtask } from "hardhat/config";
import chalk from "chalk";

import { TASK_COMPILE_SOLIDITY_LOG_COMPILATION_ERRORS } from "hardhat/builtin-tasks/task-names";

subtask(
  TASK_COMPILE_SOLIDITY_LOG_COMPILATION_ERRORS,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ output }: { output: any }) => {
    if (output?.errors === undefined) {
      return;
    }

    let warnings = [];

    for (const error of output.errors) {
      if (error.severity === "error") {
        const errorMessage =
          getFormattedInternalCompilerErrorMessage(error) ??
          error.formattedMessage;

        console.error(chalk.red(errorMessage));
      } else if (!ignoreError(error)) {
        console.warn(chalk.yellow(error.formattedMessage));
        warnings.push(error.formattedMessage);
      }
    }

    const hasConsoleErrors = output.errors.some(isConsoleLogError);
    if (hasConsoleErrors) {
      console.error(
        chalk.red(
          `The console.log call you made isn’t supported. See https://hardhat.org/console-log for the list of supported methods.`
        )
      );
      console.log();
    }
    if (warnings.length) {
      throw new Error(
        `Found ${
          warnings.length
        } non-ignored compiler warnings: ${warnings.join("\n\n")}`
      );
    }
  }
);

const IgnoredErrorCodes = [
  "1878", // "SPDX license identifier not provided"
  "5574", // Contract code size exceeds 24576 - this is triggered during coverage, we still care about it but a seperate build task will catch it outside of the coverage context
];

const IgnoredPrefixes = ["@openzeppelin/contracts-upgradeable"];

function ignoreError({ errorCode, sourceLocation: { file } }) {
  if (IgnoredErrorCodes.includes(errorCode)) {
    return true;
  }

  if (IgnoredPrefixes.some((prefix) => file.startsWith(prefix))) {
    return true;
  }
  return false;
}

/**
 * This function returns a properly formatted Internal Compiler Error message.
 *
 * This is present due to a bug in Solidity. See: https://github.com/ethereum/solidity/issues/9926
 *
 * If the error is not an ICE, or if it's properly formatted, this function returns undefined.
 */
function getFormattedInternalCompilerErrorMessage(error: {
  formattedMessage: string;
  message: string;
  type: string;
}): string | undefined {
  if (error.formattedMessage.trim() !== "InternalCompilerError:") {
    return;
  }

  // We trim any final `:`, as we found some at the end of the error messages,
  // and then trim just in case a blank space was left
  return `${error.type}: ${error.message}`.replace(/[:\s]*$/g, "").trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isConsoleLogError(error: any): boolean {
  return (
    error.type === "TypeError" &&
    typeof error.message === "string" &&
    error.message.includes("log") &&
    error.message.includes("type(library console)")
  );
}
