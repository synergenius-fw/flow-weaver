import { describe, it, expect } from 'vitest';
import { fileToHTML, sourceToHTML } from '../../../src/diagram/index';
import { wrapSVGInHTML } from '../../../src/diagram/html-viewer';

describe('html-viewer', () => {
  describe('wrapSVGInHTML', () => {
    it('wraps SVG in a complete HTML document', () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><rect width="200" height="100" fill="#202139"/></svg>';
      const html = wrapSVGInHTML(svg);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
      expect(html).toContain('</html>');
      expect(html).toContain('<svg');
    });

    it('includes zoom controls', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain('id="controls"');
      expect(html).toContain('id="btn-in"');
      expect(html).toContain('id="btn-out"');
      expect(html).toContain('id="btn-fit"');
      expect(html).toContain('id="zoom-label"');
    });

    it('includes info panel', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain('id="info-panel"');
      expect(html).toContain('id="info-title"');
      expect(html).toContain('id="info-body"');
    });

    it('includes interactive JavaScript', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain('<script>');
      expect(html).toContain('fitToView');
      expect(html).toContain('zoomBy');
      expect(html).toContain('selectNode');
      expect(html).toContain('deselectNode');
    });

    it('uses custom title', () => {
      const html = wrapSVGInHTML('<svg></svg>', { title: 'My Workflow' });
      expect(html).toContain('<title>My Workflow — Flow Weaver</title>');
    });

    it('applies dark theme by default', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain('#202139'); // dark background
    });

    it('applies light theme when specified', () => {
      const html = wrapSVGInHTML('<svg></svg>', { theme: 'light' });
      expect(html).toContain('#f6f7ff'); // light background
    });

    it('strips SVG background pattern', () => {
      const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">',
        '<defs>',
        '<pattern id="dot-grid" width="20" height="20" patternUnits="userSpaceOnUse">',
        '<circle cx="10" cy="10" r="1.5" fill="#8e9eff" opacity="0.6"/>',
        '</pattern>',
        '</defs>',
        '<rect width="200" height="100" fill="#202139"/>',
        '<rect width="200" height="100" fill="url(#dot-grid)"/>',
        '</svg>',
      ].join('\n');
      const html = wrapSVGInHTML(svg);
      expect(html).not.toContain('dot-grid');
    });

    it('includes keyboard shortcut handlers', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain("e.key === '+'");
      expect(html).toContain("e.key === '-'");
      expect(html).toContain("e.key === '0'");
      expect(html).toContain("e.key === 'Escape'");
    });

    it('includes scroll hint', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain('id="scroll-hint"');
      expect(html).toContain('scroll to zoom');
    });

    it('uses attribute selectors for connection CSS so scope connections are included', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain('path[data-source]:hover');
      expect(html).toContain('path[data-source].dimmed');
      expect(html).toContain('.node-active');
    });

    it('builds port adjacency from all connection paths via attribute selector', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain("querySelectorAll('path[data-source]')");
      expect(html).not.toContain("querySelectorAll('.connections path')");
    });

    it('includes port-click highlighting CSS', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain('path[data-source].highlighted');
      expect(html).toContain('.port-selected');
      expect(html).toContain('.port-active');
    });

    it('includes port-click JS with selectPort and deselectPort', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain('selectPort');
      expect(html).toContain('deselectPort');
      expect(html).toContain('selectedPortId');
    });

    it('includes node selection glow animation', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain('select-pop');
      expect(html).toContain('.node-glow');
      expect(html).toContain('addNodeGlow');
      expect(html).toContain('removeNodeGlow');
    });

    it('includes port hover connection dimming', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain('body.port-hovered');
      expect(html).toContain("classList.add('dimmed')");
      expect(html).toContain("classList.remove('dimmed')");
    });

    it('includes node drag CSS with grab cursor', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain('g[data-node-id] { cursor: grab; }');
      expect(html).toContain('g[data-node-id]:active { cursor: grabbing; }');
    });

    it('includes moveNode function and connection path computation', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain('moveNode');
      expect(html).toContain('computeConnectionPath');
      expect(html).toContain('draggedNodeId');
      expect(html).toContain('nodeOffsets');
    });

    it('includes branding badge with link to flowweaver.ai', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain('id="branding"');
      expect(html).toContain('href="https://flowweaver.ai"');
      expect(html).toContain('Flow Weaver');
    });

    it('includes studio nudge toast with rotating messages', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain('id="studio-hint"');
      expect(html).toContain('nudgeMessages');
      expect(html).toContain('nudgeIndex');
    });

    it('includes reset layout button', () => {
      const html = wrapSVGInHTML('<svg></svg>');
      expect(html).toContain('id="btn-reset"');
      expect(html).toContain('resetLayout');
      expect(html).toContain('origPortPositions');
    });
  });

  describe('fileToHTML', () => {
    it('generates interactive HTML from a workflow file', () => {
      const html = fileToHTML('tests/fixtures/lead-processing.ts', {
        workflowName: 'processLead',
      });
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('data-node-id');
      expect(html).toContain('validator');
      expect(html).toContain('enricher');
      expect(html).toContain('scorer');
      expect(html).toContain('categorizer');

    });
  });

  describe('sourceToHTML', () => {
    it('generates HTML from source code', () => {
      const source = `
        /** @flowWeaver nodeType
         * @input execute
         * @output onSuccess
         * @output result
         */
        function myNode(execute: boolean): { onSuccess: boolean; result: string } {
          return { onSuccess: true, result: 'hello' };
        }

        /** @flowWeaver workflow
         * @node a myNode
         * @connect Start.execute -> a.execute
         * @connect a.result -> Exit.result
         * @param execute
         * @returns result
         */
        export function myWorkflow(execute: boolean, params: {}): { result: string } {
          throw new Error('generated');
        }
      `;
      const html = sourceToHTML(source);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('data-node-id');
    });
  });
});
