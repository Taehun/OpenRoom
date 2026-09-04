import { Suspense } from "react";
import { HomeGate, HomeGateFallback } from "../src/features/home/home-gate";

export default function Home() {
  // `HomeGate` reads `?view=` with `useSearchParams`, which a prerender cannot
  // know, so the boundary is required. The fallback is the guide's own
  // checking state, so the static HTML still carries the landing page.
  return (
    <Suspense fallback={<HomeGateFallback />}>
      <HomeGate />
    </Suspense>
  );
}
