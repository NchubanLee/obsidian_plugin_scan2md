declare module "jpeg-js" {
  interface DecodedJpeg {
    width: number;
    height: number;
    data: Uint8Array;
  }
  interface EncodedJpeg {
    width: number;
    height: number;
    data: Uint8Array;
  }
  interface JpegModule {
    decode(
      jpegData: Uint8Array | Buffer,
      opts?: {
        useTArray?: boolean;
        formatAsRGBA?: boolean;
        tolerantDecoding?: boolean;
      }
    ): DecodedJpeg;
    encode(
      imgData: { width: number; height: number; data: Uint8Array | Buffer },
      quality?: number
    ): EncodedJpeg;
  }
  const jpeg: JpegModule;
  export default jpeg;
}

declare module "qrcode-generator" {
  interface QRCode {
    addData(data: string, mode?: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
    createDataURL(cellSize: number, margin: number): string;
    createImgTag(cellSize: number, margin: number, alt?: string): string;
    createSvgTag(opts?: {
      cellSize?: number;
      margin?: number;
      scalable?: boolean;
      alt?: string;
      title?: string;
    }): string;
    createASCII(cellSize: number, margin: number, reverse?: boolean): string;
  }
  function qrcode(
    typeNumber: number,
    errorCorrectionLevel: "L" | "M" | "Q" | "H"
  ): QRCode;
  export default qrcode;
}
