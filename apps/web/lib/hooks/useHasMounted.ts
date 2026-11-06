import { useEffect, useState } from "react";

// Flowko U20: false on the server and in the first browser render, true after the first effect.
// For values only the browser knows (its time zone, the current time), so the server HTML and the
// hydrating render match and React does not throw #418.
export function useHasMounted(): boolean {
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);
  return hasMounted;
}
