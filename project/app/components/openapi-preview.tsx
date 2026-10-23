import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';

export default function OpenApiPreview({ document }: { document: Record<string, unknown> }) {
  return <SwaggerUI spec={document} supportedSubmitMethods={[]} queryConfigEnabled={false}
    plugins={[{ components: { onlineValidatorBadge: () => null } }]}
    requestInterceptor={() => { throw new Error('Network requests are disabled in the local OpenAPI preview.'); }} />;
}
