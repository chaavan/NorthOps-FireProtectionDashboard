"use client";

import type { ReactNode } from "react";
import {
  estimateSectionCard,
  estimateSectionCardHeader,
  estimateSectionDescription,
  estimateSectionTitle,
} from "@/lib/estimate/estimateUi";

type EstimateSectionCardProps = {
  title: string;
  description?: string;
  rightSlot?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

export default function EstimateSectionCard({
  title,
  description,
  rightSlot,
  children,
  className = "",
  bodyClassName = "p-5",
}: EstimateSectionCardProps) {
  return (
    <section className={`${estimateSectionCard} ${className}`}>
      <div className={estimateSectionCardHeader}>
        <div>
          <h3 className={estimateSectionTitle}>{title}</h3>
          {description ? (
            <p className={estimateSectionDescription}>{description}</p>
          ) : null}
        </div>
        {rightSlot}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
