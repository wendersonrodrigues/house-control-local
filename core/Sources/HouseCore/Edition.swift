import Foundation

/// HomeOs Bar, the fork of House Control for one home on Home Assistant. What the original
/// offers besides (Smart Life, Philips Hue, Apple Home, AI Access, phone pairing) stays in the
/// code, so its changes keep merging, but is not shown. Change these to bring a piece back.
public enum Edition {
    public static let name = "HomeOs Bar"
    /// The platforms the editor and Settings offer, by `DeviceService.id`.
    public static let platforms: Set<String> = ["homeassistant"]
    /// A private link that lets an AI assistant run the home (a Cloudflare tunnel).
    public static let aiAccess = false
    /// Pairing an iPhone or an Android phone with the Mac.
    public static let phones = false
    /// The island in the middle of the menu bar (a second 3D view of the home). Off: it is never
    /// created, so it costs no GPU or memory, and its switches are not shown. HOUSE_ISLAND=1
    /// still brings it up for one run.
    public static let island = false
}
