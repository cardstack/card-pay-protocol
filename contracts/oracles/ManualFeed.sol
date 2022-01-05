pragma solidity ^0.8.9;
pragma abicoder v1;

import "@chainlink/contracts/src/v0.5/interfaces/AggregatorV3Interface.sol";

import "../core/Ownable.sol";
import "../core/Versionable.sol";
import "../VersionManager.sol";

contract ManualFeed is Ownable, Versionable, AggregatorV3Interface {
  struct RoundData {
    bool exists;
    int256 price;
    uint256 startedAt;
    uint256 updatedAt;
  }

  string internal _description;
  uint8 internal _decimals;
  uint80 internal _currentRound;

  mapping(uint80 => RoundData) internal rounds;
  address public versionManager;

  event RoundAdded(uint80 indexed roundId);
  event FeedSetup(string description, uint8 decimals);

  function initialize(address owner) public override initializer {
    _currentRound = 0;
    OwnableInitialize(owner);
  }

  function setup(
    string calldata newDescription,
    uint8 newDecimals,
    address _versionManager
  ) external onlyOwner {
    _description = newDescription;
    _decimals = newDecimals;
    versionManager = _versionManager;
    emit FeedSetup(newDescription, newDecimals);
  }

  function addRound(
    int256 price,
    uint256 startedAt,
    uint256 updatedAt
  ) external onlyOwner {
    _currentRound++;
    rounds[_currentRound].exists = true;
    rounds[_currentRound].price = price;
    rounds[_currentRound].startedAt = startedAt;
    rounds[_currentRound].updatedAt = updatedAt;
    emit RoundAdded(_currentRound);
  }

  function currentRound() external view returns (uint80) {
    return _currentRound;
  }

  function getRoundData(uint80 _roundId)
    external
    view
    override
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    )
  {
    return _getRoundData(_roundId);
  }

  function latestRoundData()
    external
    view
    override
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    )
  {
    return _getRoundData(_currentRound);
  }

  function _getRoundData(uint80 _roundId)
    internal
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    )
  {
    RoundData memory round = rounds[_roundId];
    require(round.exists, "No data present");

    return (_roundId, round.price, round.startedAt, round.updatedAt, _roundId);
  }

  function version() external pure override returns (uint256) {
    return 3;
  }

  function decimals() external view override returns (uint8) {
    return _decimals;
  }

  function description() external view override returns (string memory) {
    return _description;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
