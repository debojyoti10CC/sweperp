// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Virtual collateral and positions for PerpLab's classroom test networks.
/// The server operator validates orders and supplies the market price.
contract PerpLabLedger {
    uint256 public constant STARTING_CENTS = 1_000_000;
    address public immutable operator = msg.sender;

    struct Terms {
        uint8 market;
        bool isShort;
        uint8 leverage;
        uint64 units;
        uint64 entry;
        uint64 margin;
        uint64 stop;
        uint64 liquidation;
    }

    struct Position {
        Terms terms;
        bool active;
    }

    mapping(address trader => bool) private initialized;
    mapping(address trader => uint256 cents) private credits;
    mapping(address trader => mapping(bytes32 id => Position)) private positions;

    event PositionOpened(
        address indexed trader, bytes32 indexed id, string orderId, Terms terms, uint256 availableCents, uint256 time
    );
    event PositionExited(
        address indexed trader, bytes32 indexed id, uint8 reason, uint64 price, int256 pnl, uint256 availableCents, uint256 time
    );

    modifier onlyOperator() {
        require(msg.sender == operator, "Operator only");
        _;
    }

    function available(address trader) public view returns (uint256) {
        return initialized[trader] ? credits[trader] : STARTING_CENTS;
    }

    function open(address trader, string calldata orderId, Terms calldata terms) external onlyOperator {
        bytes32 id = keccak256(bytes(orderId));
        Position storage position = positions[trader][id];
        require(position.terms.units == 0, "Order already recorded");
        require(trader != address(0) && terms.units > 0 && terms.entry > 0 && terms.margin > 0, "Invalid terms");
        require(terms.market < 3 && terms.liquidation > 0, "Invalid market terms");
        uint256 balance = available(trader);
        require(terms.margin <= balance, "Insufficient margin");
        initialized[trader] = true;
        credits[trader] = balance - terms.margin;
        position.terms = terms;
        position.active = true;
        emit PositionOpened(trader, id, orderId, terms, credits[trader], block.timestamp);
    }

    function exit(address trader, bytes32 id, uint64 price) external onlyOperator {
        Position storage position = positions[trader][id];
        require(position.active && price > 0, "Position unavailable");
        position.active = false;
        Terms storage terms = position.terms;
        int256 pnl = realizedPnl(terms, price);
        uint256 balance = credits[trader] + uint256(int256(uint256(terms.margin)) + pnl);
        credits[trader] = balance;
        emit PositionExited(trader, id, exitReason(terms, price), price, pnl, balance, block.timestamp);
    }

    function realizedPnl(Terms storage terms, uint64 price) private view returns (int256) {
        int256 change = int256(uint256(price)) - int256(uint256(terms.entry));
        int256 raw = change * int256(uint256(terms.units));
        if (terms.isShort) raw = -raw;
        // Round to cents the same way as Math.round, including negative halves.
        int256 pnl = raw >= 0 ? (raw + 5_000) / 10_000 : (raw - 4_999) / 10_000;
        int256 margin = int256(uint256(terms.margin));
        return pnl < -margin ? -margin : pnl;
    }

    function exitReason(Terms storage terms, uint64 price) private view returns (uint8) {
        bool liquidated = terms.isShort ? price >= terms.liquidation : price <= terms.liquidation;
        bool stopped = terms.stop != 0 && (terms.isShort ? price >= terms.stop : price <= terms.stop);
        return liquidated ? 3 : stopped ? 2 : 1;
    }
}
