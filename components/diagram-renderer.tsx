"use client";

import { useEffect, useId, useState } from "react";

type DiagramRendererProps = {
  chart: string;
};

export function DiagramRenderer({ chart }: DiagramRendererProps) {
  const diagramId = useId().replace(/:/g, "");
  const [svg, setSvg] = useState("");
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    async function renderDiagram() {
      try {
        const mermaid = (await import("mermaid")).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          securityLevel: "loose",
          themeVariables: {
            primaryColor: "#eff5ff",
            primaryTextColor: "#1b3050",
            primaryBorderColor: "#8cb4ff",
            lineColor: "#5f89d7",
            secondaryColor: "#fef6f0",
            tertiaryColor: "#f4fbff",
            fontFamily: "Manrope, sans-serif",
          },
        });

        const { svg: renderedSvg } = await mermaid.render(
          `mermaid-${diagramId}`,
          chart,
        );

        if (!isCancelled) {
          setHasError(false);
          setSvg(renderedSvg);
        }
      } catch {
        if (!isCancelled) {
          setHasError(true);
        }
      }
    }

    renderDiagram();

    return () => {
      isCancelled = true;
    };
  }, [chart, diagramId]);

  if (hasError) {
    return (
      <div className="diagram-fallback">
        Mermaid preview could not be rendered for this answer.
      </div>
    );
  }

  return <div className="diagram-shell" dangerouslySetInnerHTML={{ __html: svg }} />;
}
