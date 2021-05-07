pragma solidity 0.5.17;

import "@chainlink/contracts/src/v0.5/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "../core/Versionable.sol";

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

  event RoundAdded(uint80 indexed roundId);
  event FeedSetup(string description, uint8 decimals);

  function setup(string memory description, uint8 decimals) public onlyOwner {
    _description = description;
    _decimals = decimals;
    _currentRound = 0;
    emit FeedSetup(description, decimals);
  }

  function addRound(
    int256 price,
    uint256 startedAt,
    uint256 updatedAt
  ) public onlyOwner {
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

  function version() external view returns (uint256) {
    return 3;
  }

  function decimals() external view returns (uint8) {
    return _decimals;
  }

  function description() external view returns (string memory) {
    return _description;
  }
}
