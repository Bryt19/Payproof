import { createSolanaRpc, type Signature } from "@solana/kit";
import { SOLANA_RPC_URL } from "./config";
import type {
  LoadedAddresses,
  OnChainLookup,
  RetrievedTransaction,
  SignatureStatusResult,
} from "./payment-verification";

/**
 * Server-side RPC adapter for payment verification.
 *
 * It reads the transaction from the configured Solana Devnet endpoint. The
 * browser's view of the transaction is never used. A genesis-hash check fails
 * closed if the configured endpoint is not Devnet, so a mainnet misconfiguration
 * cannot make PayProof verify mainnet payments.
 *
 * This module must only run on the server.
 */

const RPC_TIMEOUT_MS = 12_000;
const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(RPC_TIMEOUT_MS);
}

export function createDevnetLookup(): OnChainLookup {
  const rpc = createSolanaRpc(SOLANA_RPC_URL);
  let devnetCheck: Promise<void> | null = null;

  async function assertDevnet(): Promise<void> {
    devnetCheck ??= rpc
      .getGenesisHash()
      .send({ abortSignal: timeoutSignal() })
      .then((genesisHash) => {
        if (String(genesisHash) !== DEVNET_GENESIS_HASH) {
          throw new Error(
            "The verification RPC endpoint is not Solana Devnet.",
          );
        }
      });

    return devnetCheck;
  }

  return {
    async getSignatureStatus(signature) {
      await assertDevnet();

      const { value } = await rpc
        .getSignatureStatuses([signature as Signature], {
          searchTransactionHistory: true,
        })
        .send({ abortSignal: timeoutSignal() });

      const status = value[0];
      if (!status) return null;

      const result: SignatureStatusResult = {
        confirmationStatus: status.confirmationStatus,
        err: status.err,
      };

      return result;
    },

    async getTransaction(signature) {
      await assertDevnet();

      const result = await rpc
        .getTransaction(signature as Signature, {
          commitment: "confirmed",
          encoding: "base64",
          maxSupportedTransactionVersion: 0,
        })
        .send({ abortSignal: timeoutSignal() });

      if (!result) return null;

      const loadedAddresses: LoadedAddresses | undefined =
        result.meta?.loadedAddresses
          ? {
              writable: result.meta.loadedAddresses.writable.map(String),
              readonly: result.meta.loadedAddresses.readonly.map(String),
            }
          : undefined;

      const transaction: RetrievedTransaction = {
        transactionBase64: result.transaction[0],
        metaAvailable: result.meta !== null,
        err: result.meta?.err ?? null,
        loadedAddresses,
      };

      return transaction;
    },
  };
}
