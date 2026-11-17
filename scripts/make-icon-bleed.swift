#!/usr/bin/swift
// Usage: ./scripts/make-icon-bleed.swift <icon/iconnewhome.png> macos/AppIcon.icon/Assets/homeos.png 160 160 933
// (x, y and side of the square cut from the tile, in the source's pixels)
import AppKit
// Full-bleed art for the macOS 26+ icon: the tile of iconnewhome.png without its own rounded
// corners and rim, on a gradient that matches it (the system draws the shape).
let src = NSImage(contentsOfFile: CommandLine.arguments[1])!
var rect = NSRect(x: 0, y: 0, width: src.size.width, height: src.size.height)
let cg = src.cgImage(forProposedRect: &rect, context: nil, hints: nil)!
let (x0, y0, side) = (Int(CommandLine.arguments[3])!, Int(CommandLine.arguments[4])!, Int(CommandLine.arguments[5])!)
let crop = cg.cropping(to: CGRect(x: x0, y: y0, width: side, height: side))!
let n = 1024
let ctx = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
let stops: [(CGFloat, [CGFloat])] = [(0, [0.01,0.01,0.015]), (0.18,[0.010,0.007,0.016]), (0.28,[0.003,0.002,0.052]), (0.39,[0.007,0.036,0.247]), (0.50,[0.003,0.119,0.556]), (0.60,[0.001,0.235,0.806]), (0.71,[0,0.367,0.964]), (0.82,[0,0.555,0.992]), (0.92,[0.46,0.81,0.992]), (1,[0.62,0.87,1])]
let grad = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!, colors: stops.map { CGColor(srgbRed: $0.1[0], green: $0.1[1], blue: $0.1[2], alpha: 1) } as CFArray, locations: stops.map { $0.0 })!
// CG's origin is the bottom: the top of the art (black) is at y = n
ctx.drawLinearGradient(grad, start: CGPoint(x: 0, y: CGFloat(n)), end: .zero, options: [])
ctx.interpolationQuality = .high
ctx.draw(crop, in: CGRect(x: 0, y: 0, width: n, height: n))
let out = NSBitmapImageRep(cgImage: ctx.makeImage()!)
try! out.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
