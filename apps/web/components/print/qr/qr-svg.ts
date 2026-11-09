import "server-only";
import QRCode from "qrcode";

/**
 * QR code as an SVG string, generated on the server only. Error correction M. The result encodes the URL as vector
 * paths (the token never appears as text in the markup). Never cache the output or put a token in a cache key.
 */
export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}
