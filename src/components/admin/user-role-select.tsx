"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/ui/native-select";
import { setUserRole } from "@/app/admin/roles/actions";

type Props = {
  userId: string;
  fullName: string;
  role: string;
  roles: { key: string; label: string }[];
};

export function UserRoleSelect({ userId, fullName, role, roles }: Props) {
  const [value, setValue] = useState(role);
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    const previous = value;
    setValue(next); // optimistic
    startTransition(async () => {
      const res = await setUserRole({ userId, role: next });
      if (res.ok) {
        const label = roles.find((r) => r.key === next)?.label ?? next;
        toast.success(`${fullName} is now ${label}`);
      } else {
        setValue(previous);
        toast.error(res.message);
      }
    });
  }

  return (
    <NativeSelect
      aria-label={`Role for ${fullName}`}
      value={value}
      disabled={pending}
      onChange={(e) => change(e.target.value)}
      className="h-8 min-w-32 text-xs"
    >
      {roles.map((r) => (
        <option key={r.key} value={r.key}>
          {r.label}
        </option>
      ))}
    </NativeSelect>
  );
}
