import Image from "next/image";
import Link from "next/link";
import styles from "../src/features/demo/demo-workspace.module.css";

export default function Home() {
  return (
    <main className={styles.landing}>
      <header className={styles.landingHeader}>
        <p className={styles.landingBrand}>Nook</p>
        <p className={styles.landingStatus}>Spatial commerce, in rehearsal</p>
      </header>

      <section className={styles.landingHero} aria-labelledby="nook-heading">
        <div className={styles.landingCopy}>
          <p className={styles.landingEyebrow}>Spatial Atelier</p>
          <h1 id="nook-heading">The room becomes the storefront.</h1>
          <p>
            Explore a considered room, compare fixtures, and review a cart in a
            deterministic interface study.
          </p>
          <Link className={styles.landingCta} href="/demo">
            Open deterministic demo
          </Link>
          <p className={styles.landingNote}>
            Approximate room visualization · UI-only demo
          </p>
        </div>

        <figure className={styles.landingRoom}>
          <Image
            alt="Approximate living room visualization with a cream sofa, oak coffee table, woven rug, floor lamp, chair, and potted plant."
            fill
            priority
            sizes="(min-width: 900px) 52vw, 100vw"
            src="/demo/nook-room.png"
          />
          <figcaption>
            A room-sized product surface, prepared as a local deterministic
            demo.
          </figcaption>
        </figure>
      </section>
    </main>
  );
}
