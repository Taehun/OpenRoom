import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import {
  SceneStoreProvider,
  useSceneStoreApi,
} from "../../src/features/scene/scene-context";
import {
  createSceneStore,
  type SceneStore,
} from "../../src/features/scene/scene-store";

afterEach(cleanup);

/** Reports the store the surrounding provider resolved to. */
function Probe({ onStore }: { onStore: (store: SceneStore) => void }) {
  onStore(useSceneStoreApi());
  return null;
}

test("a nested provider without a prop reuses the store above it", () => {
  const outer = createSceneStore();
  let outerSeen: SceneStore | null = null;
  let innerSeen: SceneStore | null = null;

  render(
    <SceneStoreProvider store={outer}>
      <Probe
        onStore={(store) => {
          outerSeen = store;
        }}
      />
      <SceneStoreProvider>
        <Probe
          onStore={(store) => {
            innerSeen = store;
          }}
        />
      </SceneStoreProvider>
    </SceneStoreProvider>,
  );

  expect(outerSeen).toBe(outer);
  expect(innerSeen).toBe(outer);
});

test("an explicit store prop wins over the inherited store", () => {
  const outer = createSceneStore();
  const inner = createSceneStore();
  let innerSeen: SceneStore | null = null;

  render(
    <SceneStoreProvider store={outer}>
      <SceneStoreProvider store={inner}>
        <Probe
          onStore={(store) => {
            innerSeen = store;
          }}
        />
      </SceneStoreProvider>
    </SceneStoreProvider>,
  );

  expect(innerSeen).toBe(inner);
  expect(innerSeen).not.toBe(outer);
});

test("a provider with neither a prop nor an ancestor creates a store", () => {
  let seen: SceneStore | null = null;

  render(
    <SceneStoreProvider>
      <Probe
        onStore={(store) => {
          seen = store;
        }}
      />
    </SceneStoreProvider>,
  );

  expect(seen).not.toBeNull();
  expect((seen as unknown as SceneStore).getState().scene.revision).toBe(1);
});

test("a remounted inner provider keeps the inherited scene state", () => {
  const outer = createSceneStore();
  const seen: SceneStore[] = [];

  function Tree({ mounted }: { mounted: boolean }) {
    return (
      <SceneStoreProvider store={outer}>
        {mounted ? (
          <SceneStoreProvider>
            <Probe onStore={(store) => seen.push(store)} />
          </SceneStoreProvider>
        ) : null}
      </SceneStoreProvider>
    );
  }

  const { rerender } = render(<Tree mounted />);
  rerender(<Tree mounted={false} />);
  rerender(<Tree mounted />);

  expect(seen.length).toBeGreaterThan(1);
  expect(new Set(seen).size).toBe(1);
  expect(seen[0]).toBe(outer);
});

test("useSceneStoreApi outside any provider throws", () => {
  expect(() => render(<Probe onStore={() => undefined} />)).toThrowError(
    /must be used inside SceneStoreProvider/,
  );
});
