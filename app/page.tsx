import { UploadForm } from "@/components/upload-form";

export default function Home() {
  return (
    <main className="page-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="ambient ambient-three" />
      <UploadForm />
    </main>
  );
}
