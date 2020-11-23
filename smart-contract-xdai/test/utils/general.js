const web3Utils = require("web3-utils");
const gnosisUtils = require("@gnosis.pm/safe-contracts/test/utils/general");

exports = Object.assign({}, gnosisUtils);

function fromDAICPXD2SPEND(amount, exchangeRate) {
	return web3Utils
		.toWei(web3Utils.toBN(amount))
		.mul(web3Utils.toBN(exchangeRate))
		.toString();
}

function toAmountToken(amount, decimals = "18") {
	let dec = web3Utils.toBN("10").pow(web3Utils.toBN(decimals));
	return web3Utils.toBN(amount).mul(dec);
}

const CREATE_PREPAID_CARD_TOPIC = web3.utils.keccak256(
	"CreatePrepaidCard(address,address,address,uint256)"
);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const signTypedData = async function (account, data) {
	return new Promise(function (resolve, reject) {
		web3.currentProvider.send(
			{
				jsonrpc: "2.0",
				method: "eth_signTypedData",
				params: [account, data],
				id: new Date().getTime(),
			},
			function (err, response) {
				if (err) {
					return reject(err);
				}
				resolve(response.result);
			}
		);
	});
};

const encodeMultiSendCall = (txs, multiSend) => {
	const joinedTxs = txs
		.map((tx) =>
			[
				web3.eth.abi.encodeParameter("uint8", 0).slice(-2),
				web3.eth.abi.encodeParameter("address", tx.to).slice(-40),
				web3.eth.abi.encodeParameter("uint256", tx.value).slice(-64),
				web3.eth.abi
					.encodeParameter(
						"uint256",
						web3.utils.hexToBytes(tx.data).length
					)
					.slice(-64),
				tx.data.replace(/^0x/, ""),
			].join("")
		)
		.join("");

	const encodedMultiSendCallData = multiSend.contract.methods
		.multiSend(`0x${joinedTxs}`)
		.encodeABI();

	return encodedMultiSendCallData;
};
const signer = async function (
	to,
	value,
	data,
	operation,
	txGasEstimate,
	baseGasEstimate,
	gasPrice,
	txGasToken,
	refundReceiver,
	nonce,
	owner,
	gnosisSafe
) {
	const typedData = {
		types: {
			EIP712Domain: [{ type: "address", name: "verifyingContract" }],
			// "SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)"
			SafeTx: [
				{ type: "address", name: "to" },
				{ type: "uint256", name: "value" },
				{ type: "bytes", name: "data" },
				{ type: "uint8", name: "operation" },
				{ type: "uint256", name: "safeTxGas" },
				{ type: "uint256", name: "baseGas" },
				{ type: "uint256", name: "gasPrice" },
				{ type: "address", name: "gasToken" },
				{ type: "address", name: "refundReceiver" },
				{ type: "uint256", name: "nonce" },
			],
		},
		domain: {
			verifyingContract: gnosisSafe.address,
		},
		primaryType: "SafeTx",
		message: {
			to: to,
			value: value,
			data: data,
			operation: operation,
			safeTxGas: txGasEstimate,
			baseGas: baseGasEstimate,
			gasPrice: gasPrice,
			gasToken: txGasToken,
			refundReceiver: refundReceiver,
			nonce: nonce.toNumber(),
		},
	};
	let signatureBytes = "0x";
	signatureBytes += (await signTypedData(owner, typedData)).replace("0x", "");

	return signatureBytes;
};

Object.assign(exports, {
	CREATE_PREPAID_CARD_TOPIC,
	ZERO_ADDRESS,
	fromDAICPXD2SPEND,
	toAmountToken,
	encodeMultiSendCall,
	signer,
});

module.exports = exports;
