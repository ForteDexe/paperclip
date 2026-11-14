export default () => `import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpaceProvider } from "@/context/SpaceContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";

export function createLabQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
}

export function LabProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <SpaceProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </SpaceProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}
`;
