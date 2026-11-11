// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint128, InEuint128} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// Minimal CoFHE confidential contract so the wallet analyzer has sealed
/// on-chain data to unseal. Each user stores one encrypted uint128; only the
/// user (and this contract) are FHE-allowed to access it.
contract ConfidentialDemo {
    mapping(address => euint128) private _sealedBalance;

    event SealedBalanceSet(address indexed user);

    function setSealedBalance(InEuint128 calldata encrypted) external {
        euint128 value = FHE.asEuint128(encrypted);
        _sealedBalance[msg.sender] = value;
        // Grant decryption rights: the contract (for future FHE ops) and the
        // owner (so cofhejs.unseal works client-side with a self permit).
        FHE.allowThis(value);
        FHE.allowSender(value);
        emit SealedBalanceSet(msg.sender);
    }

    /// Returns the ciphertext handle. Anyone can read the handle; only
    /// FHE-allowed accounts can actually unseal the value.
    function getSealedBalance(address user) external view returns (euint128) {
        return _sealedBalance[user];
    }
}
