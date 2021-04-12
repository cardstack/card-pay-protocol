module.exports = function (callback) {
  console.log(web3.currentProvider.addresses[0]);
  callback();
};
