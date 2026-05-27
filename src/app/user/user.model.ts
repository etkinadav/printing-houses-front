export interface User {
    id: string;
    email: string;
    printingService: string;
    branch: string[];
    provider: string[];
    language: string;
    home_printingServices_list: string[];
    home_branches_list: string[];
}