import { Activity, ArrowDownUp, Zap } from "lucide-react";
import type { Feature } from "../../api";

type Props = {
  feature?: Feature;
  mockingPaused: boolean;
  requestCount: number;
  environment: string;
};

export function FeatureOverview({
  feature,
  mockingPaused,
  requestCount,
  environment,
}: Props) {
  return (
    <div className="overview">
      <div>
        <span className="stat-icon">
          <ArrowDownUp size={17} />
        </span>
        <span>
          <small>Endpoints</small>
          <b>{feature?.endpoints.length || 0}</b>
        </span>
      </div>
      <div>
        <span className="stat-icon">
          <Zap size={17} />
        </span>
        <span>
          <small>Mocking enabled</small>
          <b>
            {mockingPaused
              ? 0
              : feature?.endpoints.filter((v) => v.enabled).length || 0}
            <em> ready to intercept</em>
          </b>
        </span>
      </div>
      <div>
        <span className="stat-icon">
          <Activity size={17} />
        </span>
        <span>
          <small>Recent requests</small>
          <b>
            {requestCount}
            <em> in {environment}</em>
          </b>
        </span>
      </div>
    </div>
  );
}
