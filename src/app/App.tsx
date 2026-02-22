import { Provider } from "react-redux";

import { ThemeProvider } from "../design-system/theme/index.ts";
import { createReviewStore } from "./store/review/index.ts";
import { ReviewWorkspaceContainer } from "../interface/review/index.ts";

const reviewStore = createReviewStore();

export function App() {
  return (
    <ThemeProvider>
      <Provider store={reviewStore}>
        <ReviewWorkspaceContainer />
      </Provider>
    </ThemeProvider>
  );
}
