pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "@openzeppelin/contract-upgradeable/contracts/cryptography/MerkleProof.sol";
import "@openzeppelin/contract-upgradeable/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";

import "./token/IERC677.sol";
import "./core/Exchange.sol";
import "./core/Versionable.sol";
import "./roles/PayableToken.sol";

contract RewardPool is Versionable, Initializable, Ownable, PayableToken {

  using SafeMath for uint256;
  using MerkleProof for bytes32[];

  uint256 private _numPaymentCycles;
  uint256 public currentPaymentCycleStartBlock;

  function initialize(
    uint256 numPaymentCycles,
    address owner
  ) public initializer {
    _numPaymentCycles = numPaymentCycles;
    initialize(owner);
  }

  mapping(address => mapping(address => uint256)) public withdrawals;
  mapping(uint256 => bytes32) payeeRoots;

  event Setup();
  event PayeeWithdraw(address indexed payee, uint256 amount);
  event MerkleRootSubmission(bytes32 payeeRoot,uint256 _numPaymentCycles);
  event PaymentCycleEnded(uint256 paymentCycle, uint256 startBlock, uint256 endBlock);

  function setup(
    address[] calldata _payableTokens
    ) external onlyOwner {
    for (uint256 i = 0; i < _payableTokens.length; i++) {
      _addPayableToken(_payableTokens[i]);
    }
    emit Setup();
  }

  function numPaymentCycles() public view returns (uint256) {
    return _numPaymentCycles;
  }

  function startNewPaymentCycle() internal onlyOwner returns(bool) {
    require(block.number > currentPaymentCycleStartBlock);

    emit PaymentCycleEnded(_numPaymentCycles, currentPaymentCycleStartBlock, block.number);

    _numPaymentCycles = _numPaymentCycles.add(1);
    currentPaymentCycleStartBlock = block.number.add(1);

    return true;
  }

  function submitPayeeMerkleRoot(bytes32 payeeRoot) public onlyOwner returns(bool) {
    payeeRoots[_numPaymentCycles] = payeeRoot;

    emit MerkleRootSubmission(payeeRoot, _numPaymentCycles);
    startNewPaymentCycle();

    return true;
  }

  function _balanceForProofWithAddress(address payableToken, address _address, bytes memory proof) internal view returns(uint256) {
    bytes32[] memory meta;
    bytes32[] memory _proof;

    (meta, _proof) = splitIntoBytes32(proof, 2);
    if (meta.length != 2) { return 0; }

    uint256 paymentCycleNumber = uint256(meta[0]);
    uint256 cumulativeAmount = uint256(meta[1]);
    if (payeeRoots[paymentCycleNumber] == 0x0) { return 0; }

    bytes32 leaf = keccak256(
                             abi.encodePacked(
                                              payableToken,
                                              _address,
                                              cumulativeAmount
                                              )
                             );
    if (withdrawals[payableToken][_address] < cumulativeAmount &&
        _proof.verify(payeeRoots[paymentCycleNumber], leaf)) {
      return cumulativeAmount.sub(withdrawals[payableToken][_address]);
    } else {
      return 0;
    }
  }

  function balanceForProofWithAddress(address payableToken, address _address, bytes memory proof) public view returns(uint256) {
    return _balanceForProofWithAddress(payableToken, _address, proof);
  }

  function balanceForProof(address payableToken, bytes memory proof) public view returns(uint256) {
    return _balanceForProofWithAddress(payableToken ,msg.sender, proof);
  }

  function withdraw(address payableToken , uint256 amount, bytes memory proof) public isValidTokenAddress(payableToken) returns(bool) {
    require(amount > 0);
    require(IERC677(payableToken).balanceOf(address(this)) >= amount);

    uint256 balance = balanceForProof(payableToken,proof);
    require(balance >= amount);

    withdrawals[payableToken][msg.sender] = withdrawals[payableToken][msg.sender].add(amount);
    IERC677(payableToken).transfer(msg.sender, amount);


    emit PayeeWithdraw(msg.sender, amount);
    return true;
  }

  function splitIntoBytes32(bytes memory byteArray, uint256 numBytes32) internal pure returns (bytes32[] memory bytes32Array,
                                                                                        bytes32[] memory remainder) {
    require(byteArray.length.div(32) <= 50);
    require(byteArray.length % 32 == 0 && byteArray.length >= numBytes32.mul(32));

    bytes32Array = new bytes32[](numBytes32);
    remainder = new bytes32[](byteArray.length.sub(64).div(32));
    bytes32 _bytes32;
    for (uint256 k = 32; k <= byteArray.length; k = k.add(32)) {
      assembly {
        _bytes32 := mload(add(byteArray, k))
      }
      if(k <= numBytes32*32){
        bytes32Array[k.sub(32).div(32)] = _bytes32;
      } else {
        remainder[k.sub(96).div(32)] = _bytes32;
      }
    }
  }

}
