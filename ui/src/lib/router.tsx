import * as React from "react";
import * as RouterDom from "react-router-dom";
import type { NavigateOptions, To } from "react-router-dom";
import type { Issue } from "@outpost/shared";
import { useSpace } from "@/context/SpaceContext";
import { IssueLinkQuicklook } from "@/components/IssueLinkQuicklook";
import {
  applySpacePrefix,
  caseHref,
  extractSpacePrefixFromPath,
  normalizeSpacePrefix,
} from "@/lib/space-routes";
import { parseIssuePathIdFromPath } from "@/lib/issue-reference";

function resolveTo(to: To, spacePrefix: string | null): To {
  if (typeof to === "string") {
    return applySpacePrefix(to, spacePrefix);
  }

  if (to.pathname && to.pathname.startsWith("/")) {
    const pathname = applySpacePrefix(to.pathname, spacePrefix);
    if (pathname !== to.pathname) {
      return { ...to, pathname };
    }
  }

  return to;
}

export function useActiveSpacePrefix(): string | null {
  const { selectedSpace } = useSpace();
  const params = RouterDom.useParams<{ spacePrefix?: string }>();
  const location = RouterDom.useLocation();

  if (params.spacePrefix) {
    return normalizeSpacePrefix(params.spacePrefix);
  }

  const pathPrefix = extractSpacePrefixFromPath(location.pathname);
  if (pathPrefix) return pathPrefix;

  return selectedSpace ? normalizeSpacePrefix(selectedSpace.issuePrefix) : null;
}

/**
 * Returns a builder for space-prefixed Cases hrefs bound to the active space
 * (e.g. `/PAP/cases/PAP-C5`). Use for all case-to-case links so they emit
 * prefixed paths directly instead of leaning on the PAP-13002 redirect.
 */
export function useCaseHref(): (...segments: string[]) => string {
  const spacePrefix = useActiveSpacePrefix();
  return React.useCallback(
    (...segments: string[]) => caseHref(spacePrefix, ...segments),
    [spacePrefix],
  );
}

export * from "react-router-dom";

type SpaceLinkProps = React.ComponentProps<typeof RouterDom.Link> & {
  disableIssueQuicklook?: boolean;
  issuePrefetch?: Issue | null;
  issueQuicklookSide?: React.ComponentProps<typeof IssueLinkQuicklook>["issueQuicklookSide"];
  issueQuicklookAlign?: React.ComponentProps<typeof IssueLinkQuicklook>["issueQuicklookAlign"];
};

export const Link = React.forwardRef<HTMLAnchorElement, SpaceLinkProps>(
  function SpaceLink({
    to,
    disableIssueQuicklook = false,
    issuePrefetch = null,
    issueQuicklookSide,
    issueQuicklookAlign,
    ...props
  }, ref) {
    const spacePrefix = useActiveSpacePrefix();
    const resolvedTo = resolveTo(to, spacePrefix);
    const issuePathId = parseIssuePathIdFromPath(typeof resolvedTo === "string" ? resolvedTo : resolvedTo.pathname);

    if (issuePathId) {
      return (
        <IssueLinkQuicklook
          ref={ref}
          to={resolvedTo}
          issuePathId={issuePathId}
          disableIssueQuicklook={disableIssueQuicklook}
          issuePrefetch={issuePrefetch}
          issueQuicklookSide={issueQuicklookSide}
          issueQuicklookAlign={issueQuicklookAlign}
          {...props}
        />
      );
    }

    return <RouterDom.Link ref={ref} to={resolvedTo} {...props} />;
  },
);

export const NavLink = React.forwardRef<HTMLAnchorElement, React.ComponentProps<typeof RouterDom.NavLink>>(
  function SpaceNavLink({ to, ...props }, ref) {
    const spacePrefix = useActiveSpacePrefix();
    return <RouterDom.NavLink ref={ref} to={resolveTo(to, spacePrefix)} {...props} />;
  },
);

export function Navigate({ to, ...props }: React.ComponentProps<typeof RouterDom.Navigate>) {
  const spacePrefix = useActiveSpacePrefix();
  return <RouterDom.Navigate to={resolveTo(to, spacePrefix)} {...props} />;
}

export function useNavigate(): ReturnType<typeof RouterDom.useNavigate> {
  const navigate = RouterDom.useNavigate();
  const spacePrefix = useActiveSpacePrefix();

  return React.useCallback(
    ((to: To | number, options?: NavigateOptions) => {
      if (typeof to === "number") {
        navigate(to);
        return;
      }
      navigate(resolveTo(to, spacePrefix), options);
    }) as ReturnType<typeof RouterDom.useNavigate>,
    [navigate, spacePrefix],
  );
}
