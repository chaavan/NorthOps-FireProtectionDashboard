"use client";

import { useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { softwareConfig } from "@/lib/softwareConfig";
import { removeSurveyPopupDom } from "@/lib/survey/surveySnooze";
import SurveyPopup from "@/components/survey/SurveyPopup";

const PUBLIC_PATH_PREFIXES = ["/login", "/auth", "/select"];

function isPublicPath(pathname: string | null): boolean {
  if (!pathname) return true;
  if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }
  if (softwareConfig.portalEnabled && pathname === "/") {
    return true;
  }
  return false;
}

export default function SurveyPopupHost() {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  const isDeveloper = !!(session?.user as { isDeveloper?: boolean } | undefined)
    ?.isDeveloper;

  const surveyDisabled =
    process.env.NEXT_PUBLIC_DISABLE_SURVEY_POPUP === "true";

  const shouldMountSurvey = useMemo(() => {
    if (surveyDisabled) return false;
    if (status !== "authenticated" || !session?.user) return false;
    if (isDeveloper) return false;
    if (isPublicPath(pathname)) return false;
    return true;
  }, [surveyDisabled, status, session?.user, isDeveloper, pathname]);

  useEffect(() => {
    if (!shouldMountSurvey) {
      removeSurveyPopupDom();
    }
  }, [shouldMountSurvey]);

  useEffect(() => {
    if (
      process.env.NODE_ENV === "development" &&
      shouldMountSurvey &&
      isDeveloper
    ) {
      console.warn(
        "[SurveyPopupHost] Survey mounted for developer session — this should not happen.",
      );
    }
  }, [shouldMountSurvey, isDeveloper]);

  if (!shouldMountSurvey) {
    return null;
  }

  return <SurveyPopup />;
}
