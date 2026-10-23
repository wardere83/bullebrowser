import Capacitor

@objc(BrowserViewController)
class BrowserViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MobileAgentPlugin())
    }
}
