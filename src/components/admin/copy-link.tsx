"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CopyLink({ link, label }: { link: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it manually.");
    }
  }

  return (
    <div className="flex gap-2">
      <Input readOnly value={link} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <Button type="button" variant="outline" onClick={copy} aria-label="Copy link">
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}
