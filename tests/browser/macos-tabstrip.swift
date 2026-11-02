// Native window evidence for edge-tabstrip.mjs. Never captures the whole desktop.
import Foundation
import CoreGraphics
import ImageIO
import ApplicationServices

func output(_ value: Any) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}
enum ProbeError: Error { case invalid(String) }
func fail(_ message: String) -> Never {
    try? output(["error": message]); exit(2)
}
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var result: CFTypeRef?; AXUIElementCopyAttributeValue(element, name as CFString, &result); return result
}
let args = CommandLine.arguments
do {
    guard args.count >= 3 else { throw ProbeError.invalid("Expected window PID, keep PID, or pixels FILE WIDTH HEIGHT MARKER") }
    if args[1] == "window" {
        guard let pid = Int(args[2]), pid > 0 else { throw ProbeError.invalid("Invalid PID") }
        let windows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        let matches = windows.filter { item in
            let bounds = item[kCGWindowBounds as String] as? [String: Double] ?? [:]
            return item[kCGWindowOwnerPID as String] as? Int == pid
                && item[kCGWindowLayer as String] as? Int == 0
                && (bounds["Width"] ?? 0) >= 600 && (bounds["Height"] ?? 0) >= 300
        }
        guard matches.count == 1, let window = matches.first,
              let number = window[kCGWindowNumber as String] as? Int,
              let bounds = window[kCGWindowBounds as String] as? [String: Double]
        else { throw ProbeError.invalid("Expected exactly one large window owned by isolated Edge PID; found \(matches.count)") }
        try output(["pid": pid, "windowId": number, "bounds": bounds,
                    "onScreen": window[kCGWindowIsOnscreen as String] as? Bool ?? false])
    } else if args[1] == "keep" {
        // Consent is restricted to the isolated browser PID selected by the caller.
        guard let pid = Int32(args[2]), pid > 0 else { throw ProbeError.invalid("Invalid PID") }
        var visited = 0, found = false, pressed = false
        func visit(_ element: AXUIElement, _ depth: Int) {
            visited += 1; if depth > 18 || visited > 2000 || pressed { return }
            let role = attribute(element, kAXRoleAttribute) as? String ?? ""
            let names = [attribute(element, kAXTitleAttribute) as? String ?? "", attribute(element, kAXDescriptionAttribute) as? String ?? ""]
            if role == "AXButton" && names.contains(where: { ["Keep changes", "保留更改", "保留變更"].contains($0) }) {
                found = true; pressed = AXUIElementPerformAction(element, kAXPressAction as CFString) == .success
            }
            for child in attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] { visit(child, depth + 1) }
        }
        visit(AXUIElementCreateApplication(pid), 0)
        try output(["pid": pid, "found": found, "pressed": pressed, "accessibilityAvailable": visited > 1])
    } else if args[1] == "pixels" {
        guard args.count == 6, let logicalWidth = Double(args[3]), let logicalHeight = Double(args[4]),
              logicalWidth > 0, logicalHeight > 0, ["magenta", "cyan"].contains(args[5]),
              let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { throw ProbeError.invalid("Invalid screenshot or pixel arguments") }
        let sx = Double(image.width) / logicalWidth, sy = Double(image.height) / logicalHeight
        guard abs(sx - sy) < 0.05 else { throw ProbeError.invalid("Screenshot/window scale mismatch") }
        // First tab only, above the omnibox and all webpage pixels. No webpage screenshot is accepted.
        let rect = CGRect(x: 100 * sx, y: 0, width: 260 * sx, height: 44 * sy).integral
        guard let crop = image.cropping(to: rect), let space = CGColorSpace(name: CGColorSpace.sRGB)
        else { throw ProbeError.invalid("Cannot crop native tab strip") }
        let width = crop.width, height = crop.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = pixels.withUnsafeMutableBytes { raw -> Bool in
            guard let context = CGContext(data: raw.baseAddress, width: width, height: height,
                bitsPerComponent: 8, bytesPerRow: width * 4, space: space,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)
            else { return false }
            context.draw(crop, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { throw ProbeError.invalid("Cannot decode screenshot pixels") }
        var count = 0, minX = width, maxX = -1, minY = height, maxY = -1
        for y in 0..<height { for x in 0..<width {
            let n = (y * width + x) * 4
            let r = Int(pixels[n]), g = Int(pixels[n + 1]), b = Int(pixels[n + 2]), a = Int(pixels[n + 3])
            let match = args[5] == "magenta" ? (r > 180 && g < 80 && b > 150) : (r < 80 && g > 140 && b > 160)
            if a > 220 && match { count += 1; minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) }
        } }
        try output(["marker": args[5], "imageWidth": image.width, "imageHeight": image.height,
                    "scaleX": sx, "scaleY": sy, "roiLogical": [100, 0, 260, 44],
                    "markerPixels": count, "markerLogicalPixels": Double(count) / (sx * sy),
                    "markerBoundsInCrop": count == 0 ? [] : [minX, minY, maxX, maxY]])
    } else { throw ProbeError.invalid("Unknown command") }
} catch { fail(String(describing: error)) }
