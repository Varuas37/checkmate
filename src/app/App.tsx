import { Provider } from "react-redux";

import { createReviewStore } from "./store/review/index.ts";
import { ReviewWorkspaceContainer } from "../interface/review/index.ts";

const reviewStore = createReviewStore();

export function App() {
  return (
    <Provider store={reviewStore}>
      <ReviewWorkspaceContainer />
    </Provider>
  );
}
