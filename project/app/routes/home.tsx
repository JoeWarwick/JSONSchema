import type { Route } from "./+types/home";
import styles from "./home.module.css";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Empty Template" },
    {
      name: "description",
      content: "A welcoming empty template ready for content generation",
    },
  ];
}

export default function Home() {
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>I'm an empty template.</h1>
      </div>
    </div>
  );
}
