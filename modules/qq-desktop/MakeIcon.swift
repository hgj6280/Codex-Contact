import AppKit
let destination=URL(fileURLWithPath:CommandLine.arguments[1])
try FileManager.default.createDirectory(at:destination,withIntermediateDirectories:true)
for (name,pixels) in [("icon_16x16.png",16),("icon_16x16@2x.png",32),("icon_32x32.png",32),("icon_32x32@2x.png",64),("icon_128x128.png",128),("icon_128x128@2x.png",256),("icon_256x256.png",256),("icon_256x256@2x.png",512),("icon_512x512.png",512),("icon_512x512@2x.png",1024)] {
    let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:pixels,pixelsHigh:pixels,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
    NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:bitmap)
    let transform=NSAffineTransform();transform.scale(by:CGFloat(pixels)/512);transform.concat()
    let shape=NSBezierPath(roundedRect:NSRect(x:26,y:26,width:460,height:460),xRadius:108,yRadius:108)
    NSGradient(starting:NSColor(calibratedRed:0.36,green:0.68,blue:1,alpha:1),ending:NSColor(calibratedRed:0.20,green:0.33,blue:0.86,alpha:1))!.draw(in:shape,angle:270)
    NSColor.white.setFill();NSBezierPath(roundedRect:NSRect(x:83,y:132,width:346,height:267),xRadius:84,yRadius:84).fill()
    let tail=NSBezierPath();tail.move(to:NSPoint(x:112,y:166));tail.line(to:NSPoint(x:103,y:91));tail.line(to:NSPoint(x:194,y:142));tail.close();tail.fill()
    let fox=NSAttributedString(string:"🦊",attributes:[.font:NSFont.systemFont(ofSize:220)])
    let size=fox.size();fox.draw(at:NSPoint(x:(512-size.width)/2,y:155))
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using:.png,properties:[:])!.write(to:destination.appendingPathComponent(name))
}
