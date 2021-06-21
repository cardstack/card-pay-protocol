exports.sendTxnWithRetry = async function (cb, maxAttempts = 5) {
  let attempts = 0;
  let success = false;
  do {
    try {
      attempts++;
      await cb();
      success = true;
    } catch (e) {
      if (!e.message.includes("RLP") || attempts >= maxAttempts) {
        throw e;
      }
      console.log(
        `received ${e.message}, trying again (${attempts} of ${maxAttempts} attempts)`
      );
    }
  } while (!success && attempts > maxAttempts);
};
