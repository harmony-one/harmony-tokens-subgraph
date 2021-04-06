import { BigDecimal, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Transfer } from "../../generated/templates/StandardToken/ERC20";
import { Burn } from "../../generated/templates/BurnableToken/Burnable";
import { Mint } from "../../generated/templates/MintableToken/Mintable";
import {
  Token,
  BurnEvent,
  MintEvent,
  TransferEvent,
} from "../../generated/schema";
import { toDecimal, ONE } from "../helpers/number";
import {
  decreaseAccountBalance,
  getOrCreateAccount,
  increaseAccountBalance,
  saveAccountBalanceSnapshot,
} from "./account";
import { loadToken } from "../store";

const GENESIS_ADDRESS = "0x0000000000000000000000000000000000000000";

export function handleTransfer(event: Transfer): void {
  let token = loadToken(event.address);

  if (token != null) {
    let amount = toDecimal(event.params.value, token.decimals);

    let isBurn = event.params.to.toHex() == GENESIS_ADDRESS;
    let isMint = event.params.from.toHex() == GENESIS_ADDRESS;
    let isTransfer = !isBurn && !isMint;

    // Update token event logs
    let eventEntityId: string;

    if (isBurn) {
      let eventEntity = handleBurnEvent(
        token,
        amount,
        event.params.from,
        event
      );

      eventEntityId = eventEntity.id;
    } else if (isMint) {
      let eventEntity = handleMintEvent(token, amount, event.params.to, event);

      eventEntityId = eventEntity.id;
    } else if (isTransfer) {
      let eventEntity = handleTransferEvent(
        token,
        amount,
        event.params.from,
        event.params.to,
        event
      );

      eventEntityId = eventEntity.id;
    }

    // Updates balances of accounts
    if (isTransfer || isBurn) {
      let sourceAccount = getOrCreateAccount(event.params.from);

      let accountBalance = decreaseAccountBalance(
        sourceAccount,
        token as Token,
        amount
      );
      accountBalance.block = event.block.number;
      accountBalance.modified = event.block.timestamp;
      accountBalance.transaction = event.transaction.hash;

      sourceAccount.save();
      accountBalance.save();

      // To provide information about evolution of account balances
      saveAccountBalanceSnapshot(accountBalance, eventEntityId, event);
    }

    if (isTransfer || isMint) {
      let destinationAccount = getOrCreateAccount(event.params.to);

      let accountBalance = increaseAccountBalance(
        destinationAccount,
        token as Token,
        amount
      );
      accountBalance.block = event.block.number;
      accountBalance.modified = event.block.timestamp;
      accountBalance.transaction = event.transaction.hash;

      destinationAccount.save();
      accountBalance.save();

      // To provide information about evolution of account balances
      saveAccountBalanceSnapshot(accountBalance, eventEntityId, event);
    }
  }
}

export function handleBurn(event: Burn): void {
  let token = loadToken(event.address);

  if (token != null) {
    let amount = toDecimal(event.params.value, token.decimals);

    // Persist burn event log
    let eventEntity = handleBurnEvent(
      token,
      amount,
      event.params.burner,
      event
    );

    // Update source account balance
    let account = getOrCreateAccount(event.params.burner);

    let accountBalance = decreaseAccountBalance(
      account,
      token as Token,
      amount
    );
    accountBalance.block = event.block.number;
    accountBalance.modified = event.block.timestamp;
    accountBalance.transaction = event.transaction.hash;

    account.save();
    accountBalance.save();

    // To provide information about evolution of account balances
    saveAccountBalanceSnapshot(accountBalance, eventEntity.id, event);
  }
}

export function handleMint(event: Mint): void {
  let token = loadToken(event.address);

  if (token != null) {
    let amount = toDecimal(event.params.amount, token.decimals);

    // Persist mint event log
    let eventEntity = handleMintEvent(token, amount, event.params.to, event);

    // Update destination account balance
    let account = getOrCreateAccount(event.params.to);

    let accountBalance = increaseAccountBalance(
      account,
      token as Token,
      amount
    );
    accountBalance.block = event.block.number;
    accountBalance.modified = event.block.timestamp;
    accountBalance.transaction = event.transaction.hash;

    account.save();
    accountBalance.save();

    // To provide information about evolution of account balances
    saveAccountBalanceSnapshot(accountBalance, eventEntity.id, event);
  }
}
function handleBurnEvent(
  token: Token | null,
  amount: BigDecimal,
  burner: Bytes,
  event: ethereum.Event
): BurnEvent {
  let burnEvent = new BurnEvent(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  );
  burnEvent.token = event.address.toHex();
  burnEvent.amount = amount;
  burnEvent.sender = event.transaction.from;
  burnEvent.burner = burner;

  burnEvent.block = event.block.number;
  burnEvent.timestamp = event.block.timestamp;
  burnEvent.transaction = event.transaction.hash;

  burnEvent.save();

  // Track total supply/burned
  if (token != null) {
    token.eventCount = token.eventCount.plus(ONE);
    token.burnEventCount = token.burnEventCount.plus(ONE);
    token.totalSupply = token.totalSupply.minus(amount);
    token.totalBurned = token.totalBurned.plus(amount);
    token.save();
  }

  return burnEvent;
}

function handleMintEvent(
  token: Token | null,
  amount: BigDecimal,
  destination: Bytes,
  event: ethereum.Event
): MintEvent {
  let mintEvent = new MintEvent(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  );
  mintEvent.token = event.address.toHex();
  mintEvent.amount = amount;
  mintEvent.sender = event.transaction.from;
  mintEvent.destination = destination;
  mintEvent.minter = event.transaction.from;

  mintEvent.block = event.block.number;
  mintEvent.timestamp = event.block.timestamp;
  mintEvent.transaction = event.transaction.hash;

  mintEvent.save();

  // Track total token supply/minted
  if (token != null) {
    token.eventCount = token.eventCount.plus(ONE);
    token.mintEventCount = token.mintEventCount.plus(ONE);
    token.totalSupply = token.totalSupply.plus(amount);
    token.totalMinted = token.totalMinted.plus(amount);

    token.save();
  }

  return mintEvent;
}

function handleTransferEvent(
  token: Token | null,
  amount: BigDecimal,
  source: Bytes,
  destination: Bytes,
  event: ethereum.Event
): TransferEvent {
  let transferEvent = new TransferEvent(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  );
  transferEvent.token = event.address.toHex();
  transferEvent.amount = amount;
  transferEvent.sender = source;
  transferEvent.source = source;
  transferEvent.destination = destination;

  transferEvent.block = event.block.number;
  transferEvent.timestamp = event.block.timestamp;
  transferEvent.transaction = event.transaction.hash;

  transferEvent.save();

  // Track total token transferred
  if (token != null) {
    token.eventCount = token.eventCount.plus(ONE);
    token.transferEventCount = token.transferEventCount.plus(ONE);
    token.totalTransferred = token.totalTransferred.plus(amount);

    token.save();
  }

  return transferEvent;
}