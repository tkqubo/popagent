/**
 * Developer-only utility that regenerates `resources/AppIcon.icns`. The icns
 * is committed to the repo and copied verbatim into the notify-helper bundle
 * at install time, so this script only needs to run when the icon design
 * itself changes.
 *
 *   swiftc -O resources/make-icon.swift -o /tmp/popagent-make-icon
 *   /tmp/popagent-make-icon resources/AppIcon.icns
 *
 * (Writes an icns directly via ImageIO — no iconutil shell-out.)
 */
import CoreGraphics
import Foundation
import ImageIO

private func renderIcon(size: Int) -> CGImage? {
  let colorSpace = CGColorSpaceCreateDeviceRGB()
  guard let ctx = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: size * 4,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else { return nil }

  let s = CGFloat(size)
  let bounds = CGRect(x: 0, y: 0, width: s, height: s)

  // Rounded-square mask (macOS app-icon style)
  let cornerRadius = s * 0.225
  let mask = CGPath(
    roundedRect: bounds, cornerWidth: cornerRadius, cornerHeight: cornerRadius, transform: nil)
  ctx.saveGState()
  ctx.addPath(mask)
  ctx.clip()

  // Diagonal indigo → pink gradient
  let gradientColors = [
    CGColor(red: 0.39, green: 0.40, blue: 0.95, alpha: 1.0),
    CGColor(red: 0.92, green: 0.28, blue: 0.60, alpha: 1.0),
  ]
  guard let gradient = CGGradient(
    colorsSpace: colorSpace, colors: gradientColors as CFArray, locations: [0, 1])
  else { return nil }
  ctx.drawLinearGradient(
    gradient, start: CGPoint(x: 0, y: s), end: CGPoint(x: s, y: 0), options: [])

  // Chat bubble (white) — "responding" visual
  let bubbleWidth = s * 0.62
  let bubbleHeight = s * 0.42
  let bubbleX = (s - bubbleWidth) / 2
  let bubbleY = (s - bubbleHeight) / 2 + s * 0.04
  let bubbleRect = CGRect(x: bubbleX, y: bubbleY, width: bubbleWidth, height: bubbleHeight)
  let bubbleRadius = bubbleHeight * 0.30
  let bubblePath = CGMutablePath()
  bubblePath.addRoundedRect(
    in: bubbleRect, cornerWidth: bubbleRadius, cornerHeight: bubbleRadius)

  // Tail at bottom-left of the bubble
  let tailBaseX = bubbleX + bubbleWidth * 0.22
  let tailTopY = bubbleY + bubbleHeight * 0.05
  let tailTip = CGPoint(x: bubbleX + bubbleWidth * 0.12, y: bubbleY - bubbleHeight * 0.22)
  bubblePath.move(to: CGPoint(x: tailBaseX, y: tailTopY))
  bubblePath.addLine(to: tailTip)
  bubblePath.addLine(
    to: CGPoint(x: tailBaseX + bubbleHeight * 0.32, y: tailTopY + bubbleHeight * 0.05))
  bubblePath.closeSubpath()

  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.addPath(bubblePath)
  ctx.fillPath()

  // Three indigo dots inside the bubble
  let dotRadius = bubbleHeight * 0.11
  let dotY = bubbleY + bubbleHeight / 2
  let dotCenters = [
    bubbleX + bubbleWidth * 0.30,
    bubbleX + bubbleWidth * 0.50,
    bubbleX + bubbleWidth * 0.70,
  ]
  ctx.setFillColor(CGColor(red: 0.39, green: 0.40, blue: 0.95, alpha: 1.0))
  for cx in dotCenters {
    ctx.fillEllipse(
      in: CGRect(
        x: cx - dotRadius, y: dotY - dotRadius, width: dotRadius * 2, height: dotRadius * 2))
  }

  ctx.restoreGState()
  return ctx.makeImage()
}

private func logError(_ msg: String) {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
}

private func pngData(image: CGImage) -> Data? {
  let buffer = NSMutableData()
  guard let dest = CGImageDestinationCreateWithData(
    buffer, "public.png" as CFString, 1, nil)
  else { return nil }
  CGImageDestinationAddImage(dest, image, nil)
  guard CGImageDestinationFinalize(dest) else { return nil }
  return buffer as Data
}

private func appendChunk(_ data: inout Data, type: String, payload: Data) {
  data.append(contentsOf: type.utf8)
  var length = UInt32(8 + payload.count).bigEndian
  withUnsafeBytes(of: &length) { data.append(contentsOf: $0) }
  data.append(payload)
}

private func makeIcon(at outputPath: String) -> Bool {
  // Modern PNG-based icns chunk layout. Includes the small Retina variants
  // (ic11/ic12) — without those, macOS NotificationCenter on Retina screens
  // tends to show the placeholder icon even when a valid icns is present.
  //
  // The "stored size" column is what gets encoded as a PNG; macOS displays it
  // at half that on Retina, 1x on non-Retina, etc.
  //
  //   chunk  stored  displayed (1x / 2x)
  //   ic11    32      16 / 16@2x
  //   ic12    64      32 / 32@2x
  //   ic07   128     128 / 64@2x
  //   ic13   256     128@2x       (alt small@2x bucket some readers prefer)
  //   ic08   256     256 / 128@2x
  //   ic14   512     256@2x
  //   ic09   512     512 / 256@2x
  //   ic10  1024     512@2x
  let chunks: [(type: String, size: Int)] = [
    ("ic11", 32), ("ic12", 64),
    ("ic07", 128), ("ic13", 256),
    ("ic08", 256), ("ic14", 512),
    ("ic09", 512), ("ic10", 1024),
  ]

  var pngBySize: [Int: Data] = [:]
  for (_, sz) in chunks where pngBySize[sz] == nil {
    guard let img = renderIcon(size: sz) else {
      logError("renderIcon failed for size=\(sz)")
      return false
    }
    guard let png = pngData(image: img) else {
      logError("pngData failed for size=\(sz)")
      return false
    }
    pngBySize[sz] = png
  }

  var body = Data()
  for (type, size) in chunks {
    appendChunk(&body, type: type, payload: pngBySize[size]!)
  }

  var icns = Data()
  icns.append(contentsOf: "icns".utf8)
  var total = UInt32(8 + body.count).bigEndian
  withUnsafeBytes(of: &total) { icns.append(contentsOf: $0) }
  icns.append(body)

  do {
    try icns.write(to: URL(fileURLWithPath: outputPath))
    return true
  } catch {
    logError("write icns: \(error)")
    return false
  }
}

let args = CommandLine.arguments
guard args.count >= 2 else {
  FileHandle.standardError.write("usage: make-icon <output.icns>\n".data(using: .utf8)!)
  exit(2)
}
exit(makeIcon(at: args[1]) ? 0 : 1)
