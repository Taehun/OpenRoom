import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCoreToolManifestHash } from "../webmcp/core-tool-manifest";
import type { ToolContext } from "../webmcp/tool-context";
import { createCoreTools, type ModelContextTool } from "../webmcp/tool-handlers";
import {
  PageRelayClient,
  assertSecureCryptoContext,
  isPageRelayError,
  relayCallFailure,
  type LocalMcpStatus,
  type PageRelayErrorCode,
  type RelayCallOutcome,
} from "./page-relay-client";
import { DEFAULT_RELAY_PORT, type RelayToolCall } from "./relay-protocol";

/**
 * Mounts the paired-page half of the local MCP companion beside the native
 * WebMCP registration. Both surfaces execute the very same Core 6 descriptors
 * built from the shared `ToolContext`, so a call arriving over the loopback
 * relay changes the Scene exactly the way a native host call does.
 */

export interface LocalMcpRelay {
  status: LocalMcpStatus;
  /** Why the last pair attempt failed, for a short inline explanation. */
  pairError: PageRelayErrorCode | null;
  relayPort: number;
  pair(code: string): Promise<void>;
  disconnect(): Promise<void>;
  setRelayPort(port: number): void;
}

export interface UseLocalMcpRelayOptions {
  /** Test seam; production always uses the page's own `fetch`. */
  fetchImpl?: typeof fetch;
}

const MIN_PORT = 1;
const MAX_PORT = 65_535;

export function useLocalMcpRelay(
  context: ToolContext,
  options: UseLocalMcpRelayOptions = {},
): LocalMcpRelay {
  const descriptors = useMemo(
    () =>
      new Map<string, ModelContextTool>(
        createCoreTools(context).map((tool) => [tool.name, tool]),
      ),
    [context],
  );
  const [status, setStatus] = useState<LocalMcpStatus>("not-connected");
  const [pairError, setPairError] = useState<PageRelayErrorCode | null>(null);
  const [relayPort, setRelayPortState] = useState(DEFAULT_RELAY_PORT);
  const descriptorsRef = useRef(descriptors);
  const fetchRef = useRef(options.fetchImpl);
  const clientRef = useRef<PageRelayClient | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    descriptorsRef.current = descriptors;
  }, [descriptors]);

  useEffect(() => {
    fetchRef.current = options.fetchImpl;
  }, [options.fetchImpl]);

  const handleCall = useCallback(
    async (
      call: RelayToolCall,
      signal: AbortSignal,
    ): Promise<RelayCallOutcome> => {
      const descriptor = descriptorsRef.current.get(call.toolName);
      if (!descriptor) {
        return relayCallFailure(
          call.toolName,
          "UNKNOWN_TOOL",
          "This page exposes only the Core 6 tools.",
        );
      }
      return descriptor.execute(call.input, { signal });
    },
    [],
  );

  const pair = useCallback(
    async (code: string): Promise<void> => {
      setPairError(null);
      setStatus("pairing");
      try {
        assertSecureCryptoContext();
      } catch (error) {
        setStatus("not-connected");
        setPairError("INSECURE_CONTEXT");
        throw error;
      }

      await clientRef.current?.disconnect();
      const manifestHash = await getCoreToolManifestHash();
      const fetchImpl = fetchRef.current;
      const client = new PageRelayClient({
        baseUrl: `http://127.0.0.1:${relayPort}`,
        origin: window.location.origin,
        ...(fetchImpl === undefined ? {} : { fetchImpl }),
        onCall: handleCall,
        onStatus: (next) => {
          if (mountedRef.current) setStatus(next);
        },
      });
      clientRef.current = client;

      try {
        await client.pair(code, manifestHash);
      } catch (error) {
        setPairError(isPageRelayError(error) ? error.code : "PAIR_REJECTED");
        throw error;
      }
    },
    [handleCall, relayPort],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    clientRef.current = null;
    await client?.disconnect();
    if (!mountedRef.current) return;
    setPairError(null);
    setStatus("not-connected");
  }, []);

  const setRelayPort = useCallback((port: number): void => {
    if (!Number.isFinite(port)) return;
    const next = Math.trunc(port);
    if (next < MIN_PORT || next > MAX_PORT) return;
    setRelayPortState(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const shutdown = () => {
      const client = clientRef.current;
      clientRef.current = null;
      // Aborts the poll and any running descriptor, then releases the session.
      void client?.disconnect();
    };

    window.addEventListener("pagehide", shutdown);
    window.addEventListener("beforeunload", shutdown);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", shutdown);
      window.removeEventListener("beforeunload", shutdown);
      shutdown();
    };
  }, []);

  return useMemo(
    () => ({ status, pairError, relayPort, pair, disconnect, setRelayPort }),
    [status, pairError, relayPort, pair, disconnect, setRelayPort],
  );
}
