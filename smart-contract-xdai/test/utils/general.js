const web3Utils = require("web3-utils");
const gnosisUtils = require("@gnosis.pm/safe-contracts/test/utils/general");
const web3EthAbi = require('web3-eth-abi');
const GnosisSafe = artifacts.require("gnosisSafe");


exports = Object.assign({}, gnosisUtils);

const CREATE_PREPAID_CARD_TOPIC = web3.utils.keccak256(
	"CreatePrepaidCard(address,address,address,uint256)"
);


const EXECUTE_EVENT_FAILED = web3EthAbi.encodeEventSignature("ExecutionFailure(bytes32,uint256)");

const EXECUTE_EVENT_SUCCESS = web3EthAbi.encodeEventSignature("ExecutionSuccess(bytes32,uint256)");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const EXECUTE_EVENT_META = [{
	'type': 'bytes32',
	'name': 'txHash'
}, {
	'type': 'uint256',
	'name': 'payment'
}]

const CREATE_PREPAID_CARD_META = [{
		type: "address",
		name: "supplier"
	},
	{
		type: "address",
		name: "card"
	},
	{
		type: "address",
		name: "token"
	},
	{
		type: "uint256",
		name: "amount"
	},
];


const signTypedData = async function (account, data) {
	return new Promise(function (resolve, reject) {
		web3.currentProvider.send({
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
		.map((tx) => [
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
		].join(""))
		.join("");

	const encodedMultiSendCallData = multiSend.contract.methods
		.multiSend(`0x${joinedTxs}`)
		.encodeABI();

	return encodedMultiSendCallData;
};

async function signSafeTransaction(
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
			EIP712Domain: [{
				type: "address",
				name: "verifyingContract"
			}],
			// "SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)"
			SafeTx: [{
					type: "address",
					name: "to"
				},
				{
					type: "uint256",
					name: "value"
				},
				{
					type: "bytes",
					name: "data"
				},
				{
					type: "uint8",
					name: "operation"
				},
				{
					type: "uint256",
					name: "safeTxGas"
				},
				{
					type: "uint256",
					name: "baseGas"
				},
				{
					type: "uint256",
					name: "gasPrice"
				},
				{
					type: "address",
					name: "gasToken"
				},
				{
					type: "address",
					name: "refundReceiver"
				},
				{
					type: "uint256",
					name: "nonce"
				},
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

async function getGnosisSafeFromEventLog(tx) {
	let logsData = getParamsFromEvent(tx, CREATE_PREPAID_CARD_TOPIC, CREATE_PREPAID_CARD_META);
	let cards = [];
	for (let i = 0; i < logsData.length; ++i) {
		const prepaidCard = await GnosisSafe.at(logsData[i].card);
		cards.push(prepaidCard);
	}
	return cards;
}



function getParamsFromEvent(tx, topic, decodeMetadata) {
	let eventParams = tx.receipt.rawLogs
		.filter(rawLog => (rawLog.topics[0] === topic))
		.map((rawLog) => {
			let eventParam = web3.eth.abi.decodeLog(
				decodeMetadata,
				rawLog.data,
				rawLog.topics
			);
			return eventParam;
		})
	return eventParams;
}

Object.assign(exports, {
	CREATE_PREPAID_CARD_TOPIC,
	ZERO_ADDRESS,
	EXECUTE_EVENT_FAILED,
	EXECUTE_EVENT_SUCCESS,
	EXECUTE_EVENT_META,
	encodeMultiSendCall,
	signSafeTransaction,
	getGnosisSafeFromEventLog,
	getParamsFromEvent
});

module.exports = exports;