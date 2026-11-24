import { Copy, Server } from "lucide-react";
import { ADMIN_HOST, MOCK_HOST } from "../../config";
import { Button } from "../ui/button";

type Props = {
  curl: string;
  canCopy: boolean;
  onCopy: () => Promise<void>;
};

export function ConnectTab({ curl, canCopy, onCopy }: Props) {
  return (
    <>
      <div className="section-heading">
        <div>
          <h3>Connect your application</h3>
          <p>Keep your original path. Change the origin.</p>
        </div>
        {canCopy && (
          <Button variant="outline" size="sm" onClick={() => void onCopy()}>
            <Copy size={13} />
            Copy curl
          </Button>
        )}
      </div>
      <pre className="curl">{curl}</pre>
      <div className="info-box">
        <Server size={18} />
        <div>
          <b>Two listeners, one workspace</b>
          <p>
            Admin API: {ADMIN_HOST}
            <br />
            Mock API: {MOCK_HOST}
          </p>
          <p>
            Set PUBLIC_HOST to your computer’s LAN or VPN address and
            BIND_ADDRESS=0.0.0.0 for remote devices. Keep real credentials out
            of mock requests.
          </p>
        </div>
      </div>
    </>
  );
}
