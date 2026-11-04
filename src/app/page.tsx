import { redirect } from "next/navigation";
import { Suspense } from "react";
import { destinationFor, getAccessState } from "@/lib/auth/access";

// Entry point: send every visitor to the place their state belongs.
export default function Home() {
  return (
    <Suspense fallback={null}>
      <Redirector />
    </Suspense>
  );
}

async function Redirector(): Promise<null> {
  redirect(destinationFor(await getAccessState()));
}
