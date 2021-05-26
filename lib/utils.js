exports.sendTxnWithRetry = async function (cb, maxAttempts = 5) {
  let attempts = 0;
  do {
    try {
      attempts++;
      return await cb();
    } catch (e) {
      if (!e.message.includes("RLP")) {
        throw e;
      }
      console.log(
        `received ${e.message}, trying again (${attempts} of ${maxAttempts} attempts)`
      );
    }
  } while (attempts > maxAttempts);
};
