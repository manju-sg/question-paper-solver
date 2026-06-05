"use client";

import { useEffect, useId, useState } from "react";
import type { SolutionItem } from "@/lib/solution-schema";
import { repairSmilesNotation } from "@/lib/solution-formatting";

type ChemicalStructure = SolutionItem["chemicalStructures"][number];

type StructureFigureProps = {
  structure: ChemicalStructure;
  index: number;
};

type StructureState =
  | {
      status: "loading";
      svg: string;
      error: string;
    }
  | {
      status: "ready";
      svg: string;
      error: string;
    }
  | {
      status: "failed";
      svg: string;
      error: string;
    };

let openChemLibPromise: Promise<typeof import("openchemlib")> | null = null;

function loadOpenChemLib() {
  openChemLibPromise ??= import("openchemlib");
  return openChemLibPromise;
}

function StructureFigure({ structure, index }: StructureFigureProps) {
  const renderableSmiles = repairSmilesNotation(structure.smiles);
  const [state, setState] = useState<StructureState>({
    status: "loading",
    svg: "",
    error: "",
  });
  const structureId = useId().replace(/:/g, "-");

  useEffect(() => {
    let isMounted = true;

    async function renderStructure() {
      setState({
        status: "loading",
        svg: "",
        error: "",
      });

      try {
        const module = await loadOpenChemLib();
        const OCL = ("default" in module ? module.default : module) as typeof import("openchemlib");
        const molecule = OCL.Molecule.fromSmiles(renderableSmiles);

        molecule.inventCoordinates();

        const svg = molecule.toSVG(
          360,
          220,
          `chem-${structureId}-${index}`,
          {
            autoCrop: true,
            autoCropMargin: 18,
            factorTextSize: 1.06,
            strokeWidth: 1.55,
          },
        );

        if (!isMounted) {
          return;
        }

        setState({
          status: "ready",
          svg,
          error: "",
        });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setState({
          status: "failed",
          svg: "",
          error:
            error instanceof Error
              ? error.message
              : "The structure could not be rendered.",
        });
      }
    }

    void renderStructure();

    return () => {
      isMounted = false;
    };
  }, [index, renderableSmiles, structureId]);

  return (
    <article
      aria-busy={state.status === "loading"}
      className="chemical-structure-card"
      data-chem-ready={state.status === "loading" ? "false" : "true"}
      data-chem-structure="true"
    >
      <div className="chemical-structure-card-top">
        <div>
          <h4>{structure.title}</h4>
          {structure.caption ? (
            <p className="chemical-structure-caption">{structure.caption}</p>
          ) : null}
        </div>

        <span className="chemical-structure-badge">Structure</span>
      </div>

      {state.status === "ready" ? (
        <div
          className="chemical-structure-canvas"
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      ) : state.status === "failed" ? (
        <div className="chemical-structure-fallback">
          <strong>Unable to draw this structure automatically.</strong>
          <p>{state.error}</p>
        </div>
      ) : (
        <div className="chemical-structure-loading">
          <span className="chemical-structure-loader" />
          <p>Rendering the compound structure...</p>
        </div>
      )}

      <div className="chemical-structure-footer">
        <span className="chemical-structure-smiles-label">SMILES</span>
        <code>{renderableSmiles}</code>
      </div>
    </article>
  );
}

type ChemicalStructureGalleryProps = {
  structures: SolutionItem["chemicalStructures"];
};

export function ChemicalStructureGallery({
  structures,
}: ChemicalStructureGalleryProps) {
  if (!structures.length) {
    return null;
  }

  return (
    <section className="chemical-structure-section">
      <div className="chemical-structure-section-header">
        <strong>Compound structures</strong>
        <span>
          {structures.length} {structures.length === 1 ? "diagram" : "diagrams"}
        </span>
      </div>

      <div className="chemical-structure-grid">
        {structures.map((structure, index) => (
          <StructureFigure
            index={index}
            key={`${structure.title}-${structure.smiles}-${index}`}
            structure={structure}
          />
        ))}
      </div>
    </section>
  );
}
