import { useEffect, useState } from "react";

/** True only after the client has mounted — avoids SSR/client text mismatches. */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}
