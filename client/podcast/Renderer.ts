import * as THREE from 'three';

export type RendererProps = THREE.WebGLRendererParameters & {
  gl: WebGL2RenderingContext;
  canvas?: HTMLCanvasElement;
  pixelRatio?: number;
  clearColor?: THREE.Color | string | number;
  width?: number;
  height?: number;
};

export class Renderer extends THREE.WebGLRenderer {
  constructor({
    gl: context,
    canvas,
    pixelRatio = 1,
    clearColor,
    width,
    height,
    ...props
  }: RendererProps) {
    const inputCanvas =
      canvas ??
      ({
        width: context.drawingBufferWidth,
        height: context.drawingBufferHeight,
        style: {},

        addEventListener: (() => {}) as any,

        removeEventListener: (() => {}) as any,
        clientHeight: context.drawingBufferHeight,
      } as HTMLCanvasElement);

    super({
      canvas: inputCanvas,
      context: context as unknown as WebGLRenderingContext,
      ...props,
    });

    this.setPixelRatio(pixelRatio);

    if (width && height) {
      this.setSize(width, height);
    }
    if (clearColor) {
      this.setClearColor(clearColor);
    }
  }
}
